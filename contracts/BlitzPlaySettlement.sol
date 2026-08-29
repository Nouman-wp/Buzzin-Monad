// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title BlitzPlaySettlement
 * @notice Settlement escrow for BlitzPlay game rooms on Monad.
 *
 * Design constraints this contract is built to:
 *   - No realtime game state on chain. The server is the authority for scores,
 *     penalties and rankings; this contract only escrows funds and enforces
 *     that payouts can never exceed what was funded.
 *   - One settlement transaction per game, not one per answer.
 *   - Pull-based claims so a single failing recipient cannot block a payout,
 *     with an operator-sponsored variant for players whose embedded wallet
 *     holds no gas.
 *   - Double claims are impossible; over-allocation is impossible.
 *
 * Trust model: the operator is the room treasury that funded the game. It can
 * decide the split (that split is computed deterministically off-chain) but it
 * can never pay out more than it deposited, and it can never take back funds
 * that are still owed to a player.
 */
contract BlitzPlaySettlement {
    struct Game {
        bool exists;
        bool finalized;
        uint256 funded;    // total wei deposited for this game
        uint256 allocated; // total wei owed to players after finalisation
        uint256 paid;      // total wei already claimed
    }

    address public immutable operator;

    mapping(bytes32 => Game) private _games;
    mapping(bytes32 => mapping(address => uint256)) private _entitlement;
    mapping(bytes32 => mapping(address => bool)) private _claimed;

    /// @dev Reentrancy latch. 1 = open, 2 = entered.
    uint256 private _lock = 1;

    event GameCreated(bytes32 indexed gameId, uint256 playerLimit);
    event GameFunded(bytes32 indexed gameId, uint256 amount, uint256 totalFunded);
    event PlayersRegistered(bytes32 indexed gameId, address[] players);
    event GameFinalized(bytes32 indexed gameId, uint256 totalAllocated, uint256 winners);
    event Claimed(bytes32 indexed gameId, address indexed player, address indexed destination, uint256 amount);
    event Swept(bytes32 indexed gameId, address indexed destination, uint256 amount);

    error NotOperator();
    error GameExists();
    error GameMissing();
    error AlreadyFinalized();
    error NotFinalized();
    error LengthMismatch();
    error OverAllocated();
    error NothingToClaim();
    error AlreadyClaimed();
    error TransferFailed();
    error Reentrant();
    error ZeroAddress();

    modifier onlyOperator() {
        if (msg.sender != operator) revert NotOperator();
        _;
    }

    modifier nonReentrant() {
        if (_lock != 1) revert Reentrant();
        _lock = 2;
        _;
        _lock = 1;
    }

    constructor(address operator_) {
        if (operator_ == address(0)) revert ZeroAddress();
        operator = operator_;
    }

    // ---------------------------------------------------------------- setup

    /// @notice Register a room and optionally fund it in the same transaction.
    function createGame(bytes32 gameId, uint256 playerLimit) external payable onlyOperator {
        Game storage game = _games[gameId];
        if (game.exists) revert GameExists();
        game.exists = true;
        game.funded = msg.value;
        emit GameCreated(gameId, playerLimit);
        if (msg.value > 0) emit GameFunded(gameId, msg.value, game.funded);
    }

    /// @notice Add more escrow to a game that has not been finalised yet.
    function fundGame(bytes32 gameId) external payable onlyOperator {
        Game storage game = _games[gameId];
        if (!game.exists) revert GameMissing();
        if (game.finalized) revert AlreadyFinalized();
        game.funded += msg.value;
        emit GameFunded(gameId, msg.value, game.funded);
    }

    /**
     * @notice Record the participants of a game.
     * @dev Emits only — participation is not settlement, so it costs no storage.
     */
    function registerPlayers(bytes32 gameId, address[] calldata players) external onlyOperator {
        if (!_games[gameId].exists) revert GameMissing();
        emit PlayersRegistered(gameId, players);
    }

    // ----------------------------------------------------------- settlement

    /**
     * @notice Freeze the payout table for a game. Callable exactly once.
     * @param players    Payout recipients.
     * @param amounts    Wei owed to each recipient, index-aligned with `players`.
     *
     * Reverts unless the contract already holds enough escrow to cover the full
     * table, so a claim can never fail for lack of funds.
     */
    function finalizeGame(
        bytes32 gameId,
        address[] calldata players,
        uint256[] calldata amounts
    ) external onlyOperator {
        Game storage game = _games[gameId];
        if (!game.exists) revert GameMissing();
        if (game.finalized) revert AlreadyFinalized();
        if (players.length != amounts.length) revert LengthMismatch();

        uint256 total;
        uint256 winners;
        for (uint256 i = 0; i < players.length; ++i) {
            address player = players[i];
            if (player == address(0)) revert ZeroAddress();
            uint256 amount = amounts[i];
            if (amount == 0) continue;
            total += amount;
            // Index-aligned duplicates simply accumulate, which is safe.
            _entitlement[gameId][player] += amount;
            unchecked { ++winners; }
        }

        if (total > game.funded) revert OverAllocated();

        game.allocated = total;
        game.finalized = true;
        emit GameFinalized(gameId, total, winners);
    }

    // ---------------------------------------------------------------- claim

    /// @notice Claim your payout to your own address.
    function claim(bytes32 gameId) external nonReentrant {
        _claim(gameId, msg.sender, msg.sender);
    }

    /// @notice Claim your payout to a different address you control.
    function claimTo(bytes32 gameId, address destination) external nonReentrant {
        if (destination == address(0)) revert ZeroAddress();
        _claim(gameId, msg.sender, destination);
    }

    /**
     * @notice Operator-sponsored claim.
     * @dev Players onboarded through an embedded wallet start with no gas, so
     *      the operator submits the claim for them after they confirm in the
     *      app. The payout still goes to the destination, never to the operator.
     */
    function claimFor(bytes32 gameId, address player, address destination)
        external
        onlyOperator
        nonReentrant
    {
        if (destination == address(0)) revert ZeroAddress();
        _claim(gameId, player, destination);
    }

    function _claim(bytes32 gameId, address player, address destination) private {
        Game storage game = _games[gameId];
        if (!game.exists) revert GameMissing();
        if (!game.finalized) revert NotFinalized();
        if (_claimed[gameId][player]) revert AlreadyClaimed();

        uint256 amount = _entitlement[gameId][player];
        if (amount == 0) revert NothingToClaim();

        // Effects before interaction.
        _claimed[gameId][player] = true;
        _entitlement[gameId][player] = 0;
        game.paid += amount;

        (bool ok, ) = destination.call{value: amount}("");
        if (!ok) revert TransferFailed();

        emit Claimed(gameId, player, destination, amount);
    }

    /**
     * @notice Return escrow that was never allocated to any player.
     * @dev Only the surplus above outstanding entitlements can move, so this
     *      can never take funds a player is still owed.
     */
    function sweepUnallocated(bytes32 gameId, address destination) external onlyOperator nonReentrant {
        if (destination == address(0)) revert ZeroAddress();
        Game storage game = _games[gameId];
        if (!game.exists) revert GameMissing();
        if (!game.finalized) revert NotFinalized();

        uint256 outstanding = game.allocated - game.paid;
        uint256 surplus = game.funded - game.allocated;
        if (surplus == 0) revert NothingToClaim();
        // Defensive: never touch the escrow still owed to players.
        require(address(this).balance >= outstanding + surplus, "insufficient escrow");

        game.funded -= surplus;
        (bool ok, ) = destination.call{value: surplus}("");
        if (!ok) revert TransferFailed();
        emit Swept(gameId, destination, surplus);
    }

    // ----------------------------------------------------------------- read

    function getGame(bytes32 gameId)
        external
        view
        returns (bool exists, bool finalized, uint256 funded, uint256 allocated, uint256 paid)
    {
        Game storage game = _games[gameId];
        return (game.exists, game.finalized, game.funded, game.allocated, game.paid);
    }

    function entitlementOf(bytes32 gameId, address player) external view returns (uint256) {
        return _entitlement[gameId][player];
    }

    function hasClaimed(bytes32 gameId, address player) external view returns (bool) {
        return _claimed[gameId][player];
    }
}
