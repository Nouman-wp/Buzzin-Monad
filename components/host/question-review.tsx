'use client';

import { useState } from 'react';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  ErrorState,
  Field,
  Select,
  cx,
} from '@/components/shared/ui';
import type { Challenge, RoomConfig } from '@/lib/types';

/**
 * Question review.
 *
 * Generated content lands here as PENDING_APPROVAL and cannot play until a
 * human accepts it. Editing an item both fixes it and approves it, because an
 * edited question has by definition been read by the host.
 *
 * The second job of this panel is keeping a secret. The host dashboard is
 * routinely on a projector behind the host while people play, and a reviewed
 * question list is a list of answers. So an approved question collapses to a
 * single line the moment it is approved — its work is done — and `hideAnswers`
 * masks every answer key and explanation still on screen. Both are purely
 * presentational: nothing here changes what the server sends or how it grades.
 */

export function QuestionReview({
  roomId,
  config,
  questions,
  aiEnabled,
  locked,
  hideAnswers,
  onToggleHideAnswers,
  onChanged,
}: {
  roomId: string;
  config: RoomConfig;
  questions: Challenge[];
  aiEnabled: boolean;
  locked: boolean;
  /** Presentation mode: mask every answer key and explanation. */
  hideAnswers: boolean;
  onToggleHideAnswers: () => void;
  onChanged: () => Promise<void>;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  /** Explicit expand/collapse, keyed by question id. Overrides the default. */
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});

  const [topic, setTopic] = useState(config.topic);
  const [difficulty, setDifficulty] = useState(config.difficulty);
  const [count, setCount] = useState(config.questionCount);

  const approved = questions.filter((question) => question.status === 'APPROVED').length;
  const pending = questions.filter((question) => question.status === 'PENDING_APPROVAL').length;

  /**
   * A question is open by default only while it still needs a decision. Once
   * approved it collapses, and in presentation mode nothing opens on its own.
   */
  const isOpen = (question: Challenge): boolean =>
    overrides[question.id] ?? (!hideAnswers && question.status !== 'APPROVED');

  const toggle = (id: string, open: boolean) =>
    setOverrides((current) => ({ ...current, [id]: open }));

  const setAllOpen = (open: boolean) =>
    setOverrides(Object.fromEntries(questions.map((question) => [question.id, open])));

  const call = async (
    key: string,
    url: string,
    init: RequestInit,
    successNote?: string,
  ) => {
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(url, init);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? 'Request failed');
      if (data.warning) setNotice(data.warning as string);
      else if (successNote) setNotice(successNote);
      await onChanged();
      return data;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Request failed');
      return null;
    } finally {
      setBusy(null);
    }
  };

  const generate = () =>
    call(
      'generate',
      `/api/rooms/${roomId}/questions/generate`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ topic, difficulty, count, mode: config.mode }),
      },
      'Questions generated. Review and approve before starting.',
    );

  const useSeeded = () =>
    call(
      'seed',
      `/api/rooms/${roomId}/questions/seed`,
      { method: 'POST' },
      'Loaded the approved local pool.',
    );

  const approveAll = async () => {
    const result = await call('approveAll', `/api/rooms/${roomId}/questions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'approveAll' }),
    });
    // Approving is the moment the list stops being a worklist and starts being
    // a spoiler, so it collapses itself.
    if (result) setAllOpen(false);
    return result;
  };

  const setStatus = async (id: string, action: 'approve' | 'reject') => {
    const result = await call(id, `/api/rooms/${roomId}/questions/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action }),
    });
    if (result && action === 'approve') toggle(id, false);
    return result;
  };

  const anyOpen = questions.some(isOpen);

  return (
    <Card>
      <CardHeader
        title="Questions"
        subtitle={`${approved} approved · ${pending} pending · ${questions.length} total`}
        action={
          <div className="flex flex-wrap items-center justify-end gap-2">
            {questions.length > 0 && (
              <Button
                size="sm"
                variant="ghost"
                aria-expanded={anyOpen}
                onClick={() => setAllOpen(!anyOpen)}
              >
                {anyOpen ? 'Collapse all' : 'Expand all'}
              </Button>
            )}
            <Button
              size="sm"
              variant={hideAnswers ? 'secondary' : 'ghost'}
              aria-pressed={hideAnswers}
              title="Mask answer keys so this dashboard is safe to project"
              onClick={onToggleHideAnswers}
            >
              {hideAnswers ? 'Answers hidden' : 'Hide answers'}
            </Button>
            {!locked && (
              <>
                <Button size="sm" variant="secondary" loading={busy === 'seed'} onClick={useSeeded}>
                  Use seeded
                </Button>
                <Button size="sm" loading={busy === 'generate'} onClick={generate}>
                  Generate
                </Button>
              </>
            )}
          </div>
        }
      />

      {!locked && (
        <div className="grid gap-3 border-b border-[var(--hairline)] p-5 sm:grid-cols-3">
          <Field
            label="Topic"
            value={topic}
            onChange={(event) => setTopic(event.target.value)}
            maxLength={60}
          />
          <Select
            label="Difficulty"
            value={difficulty}
            onChange={(event) => setDifficulty(Number(event.target.value))}
          >
            {[1, 2, 3, 4, 5].map((level) => (
              <option key={level} value={level}>
                {level}
              </option>
            ))}
          </Select>
          <Field
            label="How many"
            type="number"
            min={1}
            max={30}
            value={count}
            onChange={(event) => setCount(Number(event.target.value))}
          />
          {!aiEnabled && (
            <p className="text-xs text-ink-500 sm:col-span-3">
              No AI key is configured, so Generate draws from the approved local
              pool. Everything else behaves identically.
            </p>
          )}
        </div>
      )}

      {(error || notice) && (
        <div className="px-5 pt-4">
          {error && <ErrorState message={error} />}
          {notice && !error && (
            <p className="rounded-xl border border-volt-500/25 bg-volt-500/8 px-4 py-2.5 text-sm text-volt-300">
              {notice}
            </p>
          )}
        </div>
      )}

      {hideAnswers && (
        <p className="border-b border-[var(--hairline)] bg-ink-850 px-5 py-2.5 text-xs text-ink-400">
          Presentation mode — answer keys and explanations are masked, here and
          on the live round below. Safe to put on a projector.
        </p>
      )}

      {pending > 0 && !locked && (
        <div className="flex items-center justify-between gap-3 border-b border-[var(--hairline)] bg-amber-500/6 px-5 py-3">
          <p className="text-sm text-amber-500">
            {pending} question{pending === 1 ? '' : 's'} need review before you can start.
          </p>
          <Button size="sm" variant="secondary" loading={busy === 'approveAll'} onClick={approveAll}>
            Approve all
          </Button>
        </div>
      )}

      <ul className="divide-y divide-[var(--hairline)]">
        {questions.map((question, index) => {
          const open = isOpen(question);
          return (
            <li key={question.id} className={open ? 'p-5' : 'px-5 py-2.5'}>
              {editing === question.id ? (
                <QuestionEditor
                  roomId={roomId}
                  question={question}
                  onDone={async () => {
                    setEditing(null);
                    toggle(question.id, false);
                    await onChanged();
                  }}
                  onCancel={() => setEditing(null)}
                />
              ) : (
                <div>
                  <div className="flex items-start justify-between gap-4">
                    <button
                      type="button"
                      aria-expanded={open}
                      onClick={() => toggle(question.id, !open)}
                      className="min-w-0 flex-1 text-left"
                    >
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="tnum text-xs text-ink-500">
                          {String(index + 1).padStart(2, '0')}
                        </span>
                        <StatusPill status={question.status} />
                        <Badge tone="neutral">D{question.difficulty}</Badge>
                        <Badge tone="neutral">{question.topic}</Badge>
                        <Badge tone={question.source === 'ai' ? 'volt' : 'neutral'}>
                          {question.source}
                        </Badge>
                        <span aria-hidden className="text-xs text-ink-500">
                          {open ? '▾' : '▸'}
                        </span>
                      </span>
                      <span
                        className={cx(
                          'mt-2 block text-sm font-medium leading-snug',
                          open ? 'text-ink-50' : 'truncate text-ink-300',
                        )}
                      >
                        {hideAnswers && !open
                          ? `Question ${index + 1} — hidden`
                          : question.question}
                      </span>
                    </button>

                    {!locked && (
                      <div className="flex shrink-0 gap-1.5">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            toggle(question.id, true);
                            setEditing(question.id);
                          }}
                        >
                          Edit
                        </Button>
                        {question.status !== 'APPROVED' ? (
                          <Button
                            size="sm"
                            variant="secondary"
                            loading={busy === question.id}
                            onClick={() => setStatus(question.id, 'approve')}
                          >
                            Approve
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            variant="ghost"
                            loading={busy === question.id}
                            onClick={() => setStatus(question.id, 'reject')}
                          >
                            Reject
                          </Button>
                        )}
                      </div>
                    )}
                  </div>

                  {open && (
                    <>
                      <ol className="mt-3 grid gap-1.5 sm:grid-cols-2">
                        {question.options.map((option, optionIndex) => (
                          <li
                            key={optionIndex}
                            className={cx(
                              'rounded-lg border px-3 py-2 text-sm',
                              !hideAnswers && optionIndex === question.correctAnswerIndex
                                ? 'border-mint-500/35 bg-mint-500/8 text-mint-400'
                                : 'border-[var(--hairline)] bg-ink-850 text-ink-300',
                            )}
                          >
                            <span className="mr-2 text-xs text-ink-500">
                              {String.fromCharCode(65 + optionIndex)}
                            </span>
                            {option}
                          </li>
                        ))}
                      </ol>

                      {hideAnswers ? (
                        <p className="mt-2.5 text-xs italic text-ink-500">
                          Answer key and explanation hidden.
                        </p>
                      ) : (
                        <p className="mt-2.5 text-xs leading-relaxed text-ink-400">
                          {question.explanation}
                        </p>
                      )}

                      {question.audioUrl && (
                        <audio
                          src={question.audioUrl}
                          controls
                          preload="none"
                          className="mt-3 w-full max-w-sm"
                          aria-label={`Preview clip for question ${index + 1}`}
                        />
                      )}
                    </>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function StatusPill({ status }: { status: Challenge['status'] }) {
  if (status === 'APPROVED') return <Badge tone="mint">approved</Badge>;
  if (status === 'REJECTED') return <Badge tone="rose">rejected</Badge>;
  return <Badge tone="amber">pending</Badge>;
}

function QuestionEditor({
  roomId,
  question,
  onDone,
  onCancel,
}: {
  roomId: string;
  question: Challenge;
  onDone: () => Promise<void>;
  onCancel: () => void;
}) {
  const [text, setText] = useState(question.question);
  const [options, setOptions] = useState(question.options.slice(0, 4));
  const [correct, setCorrect] = useState(question.correctAnswerIndex);
  const [explanation, setExplanation] = useState(question.explanation);
  const [difficulty, setDifficulty] = useState(question.difficulty);
  const [topic, setTopic] = useState(question.topic);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/rooms/${roomId}/questions/${question.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'edit',
          question: {
            question: text.trim(),
            options: options.map((option) => option.trim()),
            correctAnswerIndex: correct,
            explanation: explanation.trim(),
            difficulty,
            topic: topic.trim(),
          },
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? 'Could not save');
      await onDone();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <Field
        label="Question"
        value={text}
        onChange={(event) => setText(event.target.value)}
        maxLength={240}
      />
      <div className="grid gap-2 sm:grid-cols-2">
        {options.map((option, index) => (
          <div key={index} className="flex items-end gap-2">
            <Field
              label={`Option ${String.fromCharCode(65 + index)}`}
              value={option}
              onChange={(event) => {
                const next = options.slice();
                next[index] = event.target.value;
                setOptions(next);
              }}
              maxLength={120}
            />
            <button
              type="button"
              onClick={() => setCorrect(index)}
              aria-label={`Mark option ${String.fromCharCode(65 + index)} correct`}
              className={cx(
                'mb-0 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border text-sm transition-colors',
                correct === index
                  ? 'border-mint-500/50 bg-mint-500/15 text-mint-400'
                  : 'border-[var(--hairline-strong)] text-ink-500 hover:text-ink-200',
              )}
            >
              ✓
            </button>
          </div>
        ))}
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <Field label="Topic" value={topic} onChange={(event) => setTopic(event.target.value)} />
        <Select
          label="Difficulty"
          value={difficulty}
          onChange={(event) => setDifficulty(Number(event.target.value))}
        >
          {[1, 2, 3, 4, 5].map((level) => (
            <option key={level} value={level}>
              {level}
            </option>
          ))}
        </Select>
      </div>
      <Field
        label="Explanation"
        value={explanation}
        onChange={(event) => setExplanation(event.target.value)}
        maxLength={400}
      />
      {error && <ErrorState message={error} />}
      <div className="flex gap-2">
        <Button size="sm" loading={busy} onClick={save}>
          Save and approve
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
