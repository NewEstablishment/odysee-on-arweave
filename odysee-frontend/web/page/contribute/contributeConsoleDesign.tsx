import React, { useState, useRef, useEffect } from 'react';
import Button from 'component/button';
import {
  CONTRIBUTION_TITLE,
  CONTRIBUTION_INTRO,
  CONTRIBUTION_BODY,
  WHY_POINTS,
  TRACKS,
  PROCESS_STEPS,
  QUALITY_NOTE,
  REPOSITORIES,
} from './content';
const TRACK_SLUGS = {};
TRACKS.forEach((track) => {
  TRACK_SLUGS[track.title.toLowerCase().replace(/\s+&?\s*/g, '-')] = track;
});
const REPO_SLUGS = {};
REPOSITORIES.forEach((repo) => {
  REPO_SLUGS[repo.shortLabel.toLowerCase().replace(/\s+/g, '-')] = repo;
});
const HELP_LINES = [
  'Available commands:',
  '',
  '  help             Show this message',
  '  about            About this page',
  '  why              Why contribute?',
  '  tracks           List contribution tracks',
  '  show <track>     Details for a track (e.g. show tv-apps)',
  '  steps            How the process works',
  '  repos            GitHub repositories',
  '  open <repo>      Open a repo (e.g. open frontend)',
  '  links            Quick links',
  '  clear            Clear output',
];
const CONSOLE_ROOT_CLASS =
  "tw:mx-auto tw:box-border tw:w-full tw:max-w-[1000px] tw:rounded-[0.75rem] tw:border tw:border-app-border tw:bg-app-card tw:p-[1.5rem] tw:text-app-text tw:[font-family:'Fira_Code','Fira_Mono','Consolas',monospace]";
const PROMPT_ROW_CLASS = 'tw:mt-[1rem] tw:mr-0 tw:mb-[0.3rem] tw:ml-0 tw:flex tw:items-baseline tw:gap-[0.5rem]';
const CARET_CLASS = 'tw:shrink-0 tw:font-bold tw:text-[rgba(var(--color-primary-dynamic),0.8)] tw:select-none';
const TEXT_CLASS = 'tw:my-[0.25rem] tw:leading-[1.55]';
const QUOTE_CLASS =
  'tw:my-[0.35rem] tw:[border-left:2px_solid_var(--color-border)] tw:pl-[0.5rem] tw:text-app-text-subtitle';
const REPO_LINK_CLASS =
  'tw:inline-block tw:rounded-[0.4rem] tw:border tw:border-app-border tw:px-[0.6rem] tw:py-[0.35rem] tw:text-[0.78rem] tw:text-app-text tw:no-underline tw:[transition:background_0.15s] tw:hover:bg-[rgba(var(--color-primary-dynamic),0.08)]';
const INTERACTIVE_STRONG_CLASS = 'tw:font-semibold tw:text-[rgba(var(--color-primary-dynamic),0.8)]';

function runCommand(rawInput) {
  const input = rawInput.trim().toLowerCase();
  const parts = input.split(/\s+/);
  const cmd = parts[0];
  const arg = parts.slice(1).join('-');
  if (!cmd) return null;

  switch (cmd) {
    case 'help':
    case '?':
      return HELP_LINES.map((line) =>
        line === ''
          ? {
              type: 'blank',
            }
          : {
              type: 'text',
              value: line,
            }
      );

    case 'about':
      return [
        {
          type: 'heading',
          value: CONTRIBUTION_TITLE,
        },
        {
          type: 'text',
          value: CONTRIBUTION_INTRO,
        },
        {
          type: 'text',
          value: CONTRIBUTION_BODY,
        },
      ];

    case 'why':
      return WHY_POINTS.map((point) => ({
        type: 'quote',
        value: point,
      }));

    case 'tracks':
      return [
        ...TRACKS.map((track) => ({
          type: 'text',
          value: `  ${track.title.toLowerCase().replace(/\s+&?\s*/g, '-')}/  -  ${track.summary}`,
        })),
        {
          type: 'blank',
        },
        {
          type: 'hint',
          value: 'Use "show <name>" for details, e.g. show tv-apps',
        },
      ];

    case 'show': {
      if (!arg)
        return [
          {
            type: 'error',
            value: 'Usage: show <track-name>. Try "tracks" first.',
          },
        ];
      const track = TRACK_SLUGS[arg];

      if (!track) {
        return [
          {
            type: 'error',
            value: `Unknown track "${arg}". Available: ${Object.keys(TRACK_SLUGS).join(', ')}`,
          },
        ];
      }

      return [
        {
          type: 'heading',
          value: track.title,
        },
        {
          type: 'text',
          value: track.summary,
        },
        ...track.items.map((item) => ({
          type: 'text',
          value: `  - ${item}`,
        })),
      ];
    }

    case 'steps':
    case 'process':
    case 'how':
      return [
        ...PROCESS_STEPS.map((step, index) => ({
          type: 'text',
          value: `  ${index + 1}. ${step}`,
        })),
        {
          type: 'blank',
        },
        {
          type: 'hint',
          value: QUALITY_NOTE,
        },
      ];

    case 'repos':
      return [
        ...REPOSITORIES.map((repo) => ({
          type: 'link',
          value: `  ${repo.shortLabel.padEnd(18)} ${repo.label}`,
          href: repo.href,
        })),
        {
          type: 'blank',
        },
        {
          type: 'hint',
          value: 'Use "open <name>" to visit, e.g. open frontend',
        },
      ];

    case 'open': {
      if (!arg)
        return [
          {
            type: 'error',
            value: 'Usage: open <repo>. Try "repos" first.',
          },
        ];
      const repo = REPO_SLUGS[arg];

      if (!repo) {
        return [
          {
            type: 'error',
            value: `Unknown repo "${arg}". Available: ${Object.keys(REPO_SLUGS).join(', ')}`,
          },
        ];
      }

      if (typeof window !== 'undefined') window.open(repo.href, '_blank');
      return [
        {
          type: 'text',
          value: `Opening ${repo.label}...`,
        },
      ];
    }

    case 'links':
      return [
        {
          type: 'link',
          value: '  GitHub - Help Wanted issues',
          href: REPOSITORIES[0].href,
        },
        {
          type: 'link',
          value: '  Discord - Chat with contributors',
          href: 'https://chat.odysee.com',
        },
        {
          type: 'link',
          value: '  llms.txt - Architecture docs for AI agents',
          href: 'https://llms.odysee.com',
        },
      ];

    case 'clear':
      return 'CLEAR';

    default:
      return [
        {
          type: 'error',
          value: `command not found: ${cmd}`,
        },
        {
          type: 'hint',
          value: 'Type "help" for available commands.',
        },
      ];
  }
}

const ContributeConsoleDesign = () => {
  const [entries, setEntries] = useState([]);
  const [input, setInput] = useState('');
  const [commandHistory, setCommandHistory] = useState([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const inputRef = useRef(null);
  const endRef = useRef(null);
  useEffect(() => {
    if (endRef.current)
      endRef.current.scrollIntoView({
        behavior: 'smooth',
      });
  }, [entries]);

  const handleSubmit = (e) => {
    e.preventDefault();
    const raw = input.trim();
    if (!raw) return;
    setCommandHistory((prev) => [raw, ...prev]);
    setHistoryIndex(-1);

    if (raw.toLowerCase() === 'clear') {
      setEntries([]);
      setInput('');
      return;
    }

    const output = runCommand(raw);

    if (output && output !== 'CLEAR') {
      setEntries((prev) => [
        ...prev,
        {
          cmd: raw,
          lines: output,
        },
      ]);
    }

    setInput('');
  };

  const handleKeyDown = (e) => {
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      const next = Math.min(historyIndex + 1, commandHistory.length - 1);
      setHistoryIndex(next);
      if (commandHistory[next]) setInput(commandHistory[next]);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      const next = historyIndex - 1;

      if (next < 0) {
        setHistoryIndex(-1);
        setInput('');
      } else {
        setHistoryIndex(next);
        setInput(commandHistory[next] || '');
      }
    }
  };

  return (
    <div className={CONSOLE_ROOT_CLASS}>
      <div className="tw:p-[1.5rem] tw:text-[0.85rem] tw:leading-[1.65] tw:max-[620px]:p-[1rem] tw:max-[620px]:text-[0.78rem]">
        <div className={PROMPT_ROW_CLASS}>
          <span className={CARET_CLASS}>$</span>
          <span className="tw:font-semibold">cat welcome.md</span>
        </div>
        <h1 className="tw:my-[0.4rem] tw:text-[1.6rem] tw:leading-[1.15] tw:font-bold tw:[font-family:'Geist','DM_Sans','Segoe_UI',sans-serif] tw:max-[620px]:text-[1.3rem]">
          {CONTRIBUTION_TITLE}
        </h1>
        <p className={TEXT_CLASS}>{CONTRIBUTION_INTRO}</p>
        <p className={TEXT_CLASS}>{CONTRIBUTION_BODY}</p>

        <div className="tw:mt-[0.8rem] tw:mr-0 tw:mb-[0.4rem] tw:ml-0 tw:flex tw:flex-wrap tw:gap-[0.6rem]">
          <Button button="primary" label='Find "Help Wanted"' href={REPOSITORIES[0].href} />
          <Button button="alt" label="Join Discord" href="https://chat.odysee.com" />
          <Button button="link" label="Read llms.txt" href="https://llms.odysee.com" />
        </div>

        <div className={PROMPT_ROW_CLASS}>
          <span className={CARET_CLASS}>$</span>
          <span className="tw:font-semibold">cat why.md</span>
        </div>
        {WHY_POINTS.map((point) => (
          <p key={point} className={`${TEXT_CLASS} ${QUOTE_CLASS}`}>
            {'> '}
            {point}
          </p>
        ))}

        <div className={PROMPT_ROW_CLASS}>
          <span className={CARET_CLASS}>$</span>
          <span className="tw:font-semibold">ls ./tracks/</span>
        </div>
        <div className="tw:my-[0.4rem]">
          {TRACKS.map((track) => (
            <div
              key={track.title}
              className="tw:my-[0.5rem] tw:rounded-[0.4rem] tw:border tw:border-app-border tw:bg-[rgba(var(--color-primary-dynamic),0.04)] tw:px-[0.7rem] tw:py-[0.5rem]"
            >
              <span className="tw:font-semibold tw:text-[rgba(var(--color-primary-dynamic),0.8)]">
                {track.title.toLowerCase().replace(/\s+/g, '-')}/
              </span>
              <span className="tw:text-app-text-subtitle"> - {track.summary}</span>
              <ul className="tw:mt-[0.3rem] tw:mr-0 tw:mb-0 tw:ml-0 tw:pl-[1.5rem] tw:text-[0.8rem]">
                {track.items.map((item) => (
                  <li key={item} className="tw:my-[0.1rem] tw:text-app-text-subtitle">
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className={PROMPT_ROW_CLASS}>
          <span className={CARET_CLASS}>$</span>
          <span className="tw:font-semibold">cat CONTRIBUTING.md</span>
        </div>
        <div>
          {PROCESS_STEPS.map((step, index) => (
            <p key={step} className={TEXT_CLASS}>
              <span className="tw:font-bold tw:text-[rgba(var(--color-primary-dynamic),0.8)]">{index + 1}.</span> {step}
            </p>
          ))}
        </div>
        <p
          className={`${TEXT_CLASS} tw:mt-[0.6rem] tw:[border-left:2px_solid_rgba(var(--color-primary-dynamic),0.3)] tw:pl-[0.6rem] tw:text-[0.8rem] tw:text-app-text-subtitle`}
        >
          {QUALITY_NOTE}
        </p>

        <div className={PROMPT_ROW_CLASS}>
          <span className={CARET_CLASS}>$</span>
          <span className="tw:font-semibold">cat repos.json | jq '.[]'</span>
        </div>
        <div className="tw:my-[0.5rem] tw:flex tw:flex-wrap tw:gap-[0.5rem]">
          {REPOSITORIES.map((repo) => (
            <a key={repo.label} href={repo.href} className={REPO_LINK_CLASS}>
              {'{ '}
              <span className="tw:text-[rgba(var(--color-primary-dynamic),0.8)]">"name"</span>:{' '}
              <span className="tw:text-app-text-subtitle">"{repo.shortLabel}"</span>
              {' }'}
            </a>
          ))}
        </div>

        <div className="tw:mt-[1.5rem] tw:mr-0 tw:mb-[1rem] tw:ml-0 tw:[border-top:1px_dashed_var(--color-border)]" />
        <p className="tw:mt-0 tw:mr-0 tw:mb-[0.6rem] tw:ml-0 tw:text-[0.8rem] tw:text-app-text-subtitle">
          Try it yourself - type <strong className={INTERACTIVE_STRONG_CLASS}>help</strong>,{' '}
          <strong className={INTERACTIVE_STRONG_CLASS}>tracks</strong>,{' '}
          <strong className={INTERACTIVE_STRONG_CLASS}>repos</strong>, or{' '}
          <strong className={INTERACTIVE_STRONG_CLASS}>open frontend</strong>
        </p>

        {entries.map((entry, i) => (
          <div key={i} className="tw:my-[0.4rem]">
            <div className={PROMPT_ROW_CLASS}>
              <span className={CARET_CLASS}>$</span>
              <span className="tw:font-semibold">{entry.cmd}</span>
            </div>
            <div className="tw:pl-[1.1rem]">
              {entry.lines.map((line, j) => {
                if (line.type === 'blank') {
                  return <div key={j} className="tw:h-[0.4rem]" />;
                }

                if (line.type === 'heading') {
                  return (
                    <p
                      key={j}
                      className="tw:my-[0.3rem] tw:text-[1rem] tw:font-bold tw:[font-family:'Geist','DM_Sans','Segoe_UI',sans-serif]"
                    >
                      {line.value}
                    </p>
                  );
                }

                if (line.type === 'quote') {
                  return (
                    <p key={j} className={`${TEXT_CLASS} ${QUOTE_CLASS}`}>
                      {'> '}
                      {line.value}
                    </p>
                  );
                }

                if (line.type === 'link') {
                  return (
                    <a
                      key={j}
                      className="tw:my-[0.1rem] tw:block tw:whitespace-pre-wrap tw:text-[rgba(var(--color-primary-dynamic),0.8)] tw:no-underline tw:hover:opacity-80 tw:hover:underline"
                      href={line.href}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {line.value}
                    </a>
                  );
                }

                if (line.type === 'error') {
                  return (
                    <p key={j} className="tw:my-[0.1rem] tw:text-[#e8585d]">
                      {line.value}
                    </p>
                  );
                }

                if (line.type === 'hint') {
                  return (
                    <p key={j} className="tw:my-[0.1rem] tw:text-[0.8rem] tw:text-app-text-subtitle">
                      {line.value}
                    </p>
                  );
                }

                return (
                  <p key={j} className="tw:my-[0.1rem] tw:whitespace-pre-wrap">
                    {line.value}
                  </p>
                );
              })}
            </div>
          </div>
        ))}

        <form className="tw:mt-[0.6rem] tw:flex tw:items-center tw:gap-[0.5rem]" onSubmit={handleSubmit}>
          <span className={CARET_CLASS}>$</span>
          <input
            ref={inputRef}
            type="text"
            className="tw:flex-1 tw:border-none tw:bg-transparent tw:text-app-text tw:outline-none tw:[caret-color:rgba(var(--color-primary-dynamic),0.8)] tw:[font-family:inherit] tw:[font-size:inherit] tw:[line-height:inherit] tw:placeholder:text-app-text-subtitle tw:placeholder:opacity-50"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="type a command..."
            spellCheck={false}
            autoComplete="off"
          />
        </form>
        <div ref={endRef} />
      </div>
    </div>
  );
};

export default ContributeConsoleDesign;
