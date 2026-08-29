/**
 * ABI for BlitzPlaySettlement.
 *
 * Hand-maintained and kept in sync with contracts/BlitzPlaySettlement.sol so
 * the app has no build-time dependency on the compiler artifact. Run
 * `npm run contract:build` to regenerate the full artifact when the contract
 * changes; `tests/contract-abi.test.ts` asserts the two stay aligned.
 */
export const SETTLEMENT_ABI = [
  {
    type: 'constructor',
    inputs: [{ name: 'operator_', type: 'address' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'operator',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'createGame',
    inputs: [
      { name: 'gameId', type: 'bytes32' },
      { name: 'playerLimit', type: 'uint256' },
    ],
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    name: 'fundGame',
    inputs: [{ name: 'gameId', type: 'bytes32' }],
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    name: 'registerPlayers',
    inputs: [
      { name: 'gameId', type: 'bytes32' },
      { name: 'players', type: 'address[]' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'finalizeGame',
    inputs: [
      { name: 'gameId', type: 'bytes32' },
      { name: 'players', type: 'address[]' },
      { name: 'amounts', type: 'uint256[]' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'claim',
    inputs: [{ name: 'gameId', type: 'bytes32' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'claimTo',
    inputs: [
      { name: 'gameId', type: 'bytes32' },
      { name: 'destination', type: 'address' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'claimFor',
    inputs: [
      { name: 'gameId', type: 'bytes32' },
      { name: 'player', type: 'address' },
      { name: 'destination', type: 'address' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'sweepUnallocated',
    inputs: [
      { name: 'gameId', type: 'bytes32' },
      { name: 'destination', type: 'address' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'getGame',
    inputs: [{ name: 'gameId', type: 'bytes32' }],
    outputs: [
      { name: 'exists', type: 'bool' },
      { name: 'finalized', type: 'bool' },
      { name: 'funded', type: 'uint256' },
      { name: 'allocated', type: 'uint256' },
      { name: 'paid', type: 'uint256' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'entitlementOf',
    inputs: [
      { name: 'gameId', type: 'bytes32' },
      { name: 'player', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'hasClaimed',
    inputs: [
      { name: 'gameId', type: 'bytes32' },
      { name: 'player', type: 'address' },
    ],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'event',
    name: 'GameCreated',
    inputs: [
      { name: 'gameId', type: 'bytes32', indexed: true },
      { name: 'playerLimit', type: 'uint256', indexed: false },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'GameFunded',
    inputs: [
      { name: 'gameId', type: 'bytes32', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
      { name: 'totalFunded', type: 'uint256', indexed: false },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'PlayersRegistered',
    inputs: [
      { name: 'gameId', type: 'bytes32', indexed: true },
      { name: 'players', type: 'address[]', indexed: false },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'GameFinalized',
    inputs: [
      { name: 'gameId', type: 'bytes32', indexed: true },
      { name: 'totalAllocated', type: 'uint256', indexed: false },
      { name: 'winners', type: 'uint256', indexed: false },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'Claimed',
    inputs: [
      { name: 'gameId', type: 'bytes32', indexed: true },
      { name: 'player', type: 'address', indexed: true },
      { name: 'destination', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'Swept',
    inputs: [
      { name: 'gameId', type: 'bytes32', indexed: true },
      { name: 'destination', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
    ],
    anonymous: false,
  },
] as const;
