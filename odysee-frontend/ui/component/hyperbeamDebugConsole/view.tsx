import React from 'react';
import {
  addHyperbeamDebugListener,
  hyperbeamDebugColor,
  installHyperbeamFetchDebug,
  sanitizeHyperbeamDebugValue,
  sanitizeHyperbeamDebugUrl,
  type HyperbeamDebugEvent,
} from 'util/hyperbeamDebug';
import { ODYSEE_HYPERBEAM_NODE_API } from 'config';
import { getHyperbeamMode, HYPERBEAM_MODES, setHyperbeamMode, type HyperbeamMode } from 'util/hyperbeamMode';
import ClaimTrace, { type TraceFocus } from './claimTrace';

const MAX_EVENTS = 1200;
const MAX_RELEVANT_EVENTS = 24;
const MAX_EVENTS_PER_FRAME = 80;
const FILTERS = [
  { key: 'all', label: 'all', color: 'rgba(255,255,255,0.84)' },
  { key: 'get', label: 'get', color: 'rgba(255,255,255,0.76)' },
  { key: 'failed', label: 'failed', color: '#ff4d7d' },
  { key: 'original', label: 'legacy', color: '#94a3b8' },
  { key: 'native-device', label: 'native-device', color: '#0ea5e9' },
  { key: 'native-device:auth', label: 'native-device:auth', color: '#22c55e' },
  { key: 'fallback', label: 'fallback', color: '#ffb020' },
  { key: 'other', label: 'other', color: 'rgba(255,255,255,0.5)' },
] as const;

type FilterKey = (typeof FILTERS)[number]['key'];
const CATEGORY_FILTER_KEYS = FILTERS.map((filter) => filter.key).filter(
  (key) => key !== 'all' && key !== 'other'
) as Array<FilterKey>;
const MODELED_GRAPH_DEVICES = new Set(['~cache@1.0', '~odysee-upload@1.0', '~arweave@1.0']);
const ARCHITECTURE_ARROW_MARKERS = [
  { id: 'hb-arrow-blue', color: '#38bdf8' },
  { id: 'hb-arrow-hyperbeam', color: '#0ea5e9' },
  { id: 'hb-arrow-auth', color: '#22c55e' },
  { id: 'hb-arrow-cache', color: '#facc15' },
  { id: 'hb-arrow-legacy', color: '#94a3b8' },
  { id: 'hb-arrow-muted', color: '#64748b' },
  { id: 'hb-arrow-media', color: '#fb7185' },
  { id: 'hb-arrow-arweave', color: '#c084fc' },
  { id: 'hb-arrow-ui', color: '#e879f9' },
] as const;
type SegmentKey = 'graph' | 'trace' | 'requests';
const CONSOLE_OPEN_STORAGE_KEY = 'odysee:hyperbeam-debug-console:open';
const CONSOLE_MAXIMIZED_STORAGE_KEY = 'odysee:hyperbeam-debug-console:maximized';
const CONSOLE_SEGMENTS_STORAGE_KEY = 'odysee:hyperbeam-debug-console:segments';
const DEFAULT_VISIBLE_SEGMENTS: Record<SegmentKey, boolean> = {
  graph: true,
  trace: true,
  requests: true,
};

export default function HyperbeamDebugConsole() {
  const [open, setOpen] = React.useState(() => readStoredBoolean(CONSOLE_OPEN_STORAGE_KEY, false));
  const [maximized, setMaximized] = React.useState(() => readStoredBoolean(CONSOLE_MAXIMIZED_STORAGE_KEY, false));
  const [mode, setMode] = React.useState<HyperbeamMode>(() => getHyperbeamMode());
  const [visibleSegments, setVisibleSegments] = React.useState<Record<SegmentKey, boolean>>(() => readStoredSegments());
  const [maximizedSegment, setMaximizedSegment] = React.useState<SegmentKey | null>(null);
  const [events, setEvents] = React.useState<Array<HyperbeamDebugEvent>>([]);
  const [activeTrace, setActiveTrace] = React.useState<TraceFocus | null>(null);
  const [expanded, setExpanded] = React.useState<Record<number, boolean>>({});
  const [selectedEventIndex, setSelectedEventIndex] = React.useState<number | null>(null);
  const [activeFilters, setActiveFilters] = React.useState<Set<FilterKey>>(() => new Set());
  const [requestFilterText, setRequestFilterText] = React.useState('');
  const [copied, setCopied] = React.useState(false);
  const [copiedRelevant, setCopiedRelevant] = React.useState(false);
  const logRef = React.useRef<HTMLDivElement | null>(null);
  const pendingEventsRef = React.useRef<Array<HyperbeamDebugEvent>>([]);
  const flushFrameRef = React.useRef<number | null>(null);
  const sectionRestoreRef = React.useRef<{ maximized: boolean } | null>(null);

  React.useEffect(() => {
    installHyperbeamFetchDebug();
    const flushEvents = () => {
      flushFrameRef.current = null;
      const pending = pendingEventsRef.current.splice(0, MAX_EVENTS_PER_FRAME);
      if (pending.length) {
        setEvents((current) => mergeEvents(current, pending));
      }
      if (pendingEventsRef.current.length) {
        flushFrameRef.current = window.requestAnimationFrame(flushEvents);
      }
    };
    const removeListener = addHyperbeamDebugListener((event) => {
      pendingEventsRef.current.push(event);
      if (flushFrameRef.current === null) {
        flushFrameRef.current = window.requestAnimationFrame(flushEvents);
      }
    });
    return () => {
      removeListener();
      if (flushFrameRef.current !== null) {
        window.cancelAnimationFrame(flushFrameRef.current);
        flushFrameRef.current = null;
      }
      pendingEventsRef.current = [];
    };
  }, []);

  React.useEffect(() => {
    if (!open || !logRef.current) return;
    logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [events, open]);

  React.useEffect(() => {
    writeStoredBoolean(CONSOLE_OPEN_STORAGE_KEY, open);
  }, [open]);

  React.useEffect(() => {
    writeStoredBoolean(CONSOLE_MAXIMIZED_STORAGE_KEY, maximized);
  }, [maximized]);

  React.useEffect(() => {
    writeStoredJson(CONSOLE_SEGMENTS_STORAGE_KEY, visibleSegments);
  }, [visibleSegments]);

  React.useEffect(() => {
    if (selectedEventIndex !== null && !events[selectedEventIndex]) {
      setSelectedEventIndex(null);
    }
  }, [events, selectedEventIndex]);

  const last = events[events.length - 1];
  const requestEventCount = React.useMemo(() => events.filter((event) => event.label === 'request').length, [events]);
  const filterCounts = React.useMemo(() => countFilters(events), [events]);
  const traceMatchedEvents = activeTrace
    ? events.filter((event) => eventMatchesTraceFocus(event, activeTrace))
    : events;
  const focusedFilterCounts = React.useMemo(() => countFilters(traceMatchedEvents), [traceMatchedEvents]);
  const visibleEvents =
    activeFilters.size === 0
      ? events
      : events.filter((event) =>
          FILTERS.some((filter) => activeFilters.has(filter.key) && eventMatchesFilter(event, filter.key))
        );
  const focusedEvents = activeTrace
    ? focusedEventsWithLifecyclePeers(visibleEvents, events, activeTrace)
    : visibleEvents;
  const requestFilterNeedles = React.useMemo(() => normalizedFilterNeedles(requestFilterText), [requestFilterText]);
  const requestFilteredEvents = requestFilterNeedles.length
    ? focusedEvents.filter((event) => eventMatchesObjectTextFilter(event, requestFilterNeedles))
    : focusedEvents;
  const selectedEvent =
    selectedEventIndex !== null && expanded[selectedEventIndex] ? events[selectedEventIndex] || null : null;
  const displayedSegments = maximizedSegment ? onlyVisibleSegment(maximizedSegment) : visibleSegments;
  const activeSegmentCount = Object.values(displayedSegments).filter(Boolean).length;
  const onActiveTraceChange = React.useCallback((focus: TraceFocus | null) => {
    setActiveTrace(focus);
    setSelectedEventIndex(null);
  }, []);

  const toggleFilter = (filter: FilterKey) => {
    if (filter === 'all') {
      setActiveFilters(new Set());
      return;
    }

    setActiveFilters((current) => {
      const next = new Set(current);
      if (next.has(filter)) {
        next.delete(filter);
      } else {
        next.add(filter);
      }
      return next;
    });
  };
  const toggleSegment = (segment: SegmentKey) => {
    if (maximizedSegment) {
      setMaximizedSegment(null);
      const restore = sectionRestoreRef.current;
      sectionRestoreRef.current = null;
      if (restore) setMaximized(restore.maximized);
    }
    setVisibleSegments((current) => {
      const enabled = Object.values(current).filter(Boolean).length;
      if (current[segment] && enabled === 1) return current;
      return { ...current, [segment]: !current[segment] };
    });
  };
  const toggleMaximizedSegment = (segment: SegmentKey) => {
    if (maximizedSegment === segment) {
      setMaximizedSegment(null);
      const restore = sectionRestoreRef.current;
      sectionRestoreRef.current = null;
      if (restore) setMaximized(restore.maximized);
      return;
    }

    sectionRestoreRef.current = { maximized };
    setOpen(true);
    setMaximized(true);
    setMaximizedSegment(segment);
  };

  const copyEvents = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    const text = JSON.stringify(events, null, 2);
    navigator.clipboard
      ?.writeText(text)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1200);
      })
      .catch(() => setCopied(false));
  };
  const copyRelevantEvents = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    const text = JSON.stringify(
      {
        type: 'odysee_request_events',
        node: mode === HYPERBEAM_MODES.original ? undefined : String(ODYSEE_HYPERBEAM_NODE_API).replace(/\/+$/, ''),
        mode,
        generatedAt: new Date().toISOString(),
        events: relevantEvents(events, mode),
      },
      null,
      2
    );
    navigator.clipboard
      ?.writeText(text)
      .then(() => {
        setCopiedRelevant(true);
        window.setTimeout(() => setCopiedRelevant(false), 1200);
      })
      .catch(() => setCopiedRelevant(false));
  };
  const onModeChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const nextMode = event.currentTarget.value as HyperbeamMode;
    setMode(nextMode);
    setHyperbeamMode(nextMode);
    setEvents([]);
    window.location.reload();
  };

  return (
    <div
      data-hyperbeam-debug-console
      style={{
        position: 'fixed',
        right: open ? 0 : 12,
        bottom: open ? 0 : 12,
        top: maximized ? 0 : undefined,
        left: open ? 0 : undefined,
        zIndex: 100000,
        width: open ? 'auto' : 'auto',
        maxWidth: open ? '100vw' : 'calc(100vw - 24px)',
        maxHeight: maximized ? '100vh' : '58vh',
        height: maximized ? '100vh' : undefined,
        display: 'flex',
        flexDirection: 'column',
        boxSizing: 'border-box',
        overflow: 'hidden',
        borderRadius: open ? (maximized ? 0 : '6px 6px 0 0') : 6,
        border: '1px solid rgba(222, 0, 80, 0.62)',
        background: 'rgba(12, 10, 12, 0.95)',
        backdropFilter: 'blur(14px)',
        WebkitBackdropFilter: 'blur(14px)',
        color: '#f9fafb',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: 11,
        lineHeight: 1.35,
        boxShadow: '0 12px 34px rgba(0,0,0,0.46), 0 0 28px rgba(222,0,80,0.2)',
      }}
    >
      <div
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          boxSizing: 'border-box',
          padding: '0 8px 0 0',
          background: 'linear-gradient(90deg, rgba(222,0,80,0.42), rgba(222,0,80,0.12))',
        }}
      >
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          style={{
            flex: '1 1 auto',
            minWidth: 0,
            border: 0,
            padding: '8px 10px',
            background: 'transparent',
            color: '#f9fafb',
            textAlign: 'left',
            cursor: 'pointer',
            font: 'inherit',
          }}
        >
          Odysee request log
          {!open && last ? ` · ${last.label} · ${last.level}` : ''}
        </button>
        {open && (
          <div style={{ display: 'flex', gap: 4, flex: '0 0 auto' }}>
            <SegmentToggle active={displayedSegments.trace} onClick={() => toggleSegment('trace')}>
              Trace
            </SegmentToggle>
            <SegmentToggle active={displayedSegments.requests} onClick={() => toggleSegment('requests')}>
              Requests {requestEventCount} · Events {events.length}
            </SegmentToggle>
            <SegmentToggle active={displayedSegments.graph} onClick={() => toggleSegment('graph')}>
              Graph
            </SegmentToggle>
          </div>
        )}
        <select
          value={mode}
          onClick={(event) => event.stopPropagation()}
          onChange={onModeChange}
          title="Select request wiring mode"
          style={{
            width: 88,
            height: 18,
            border: '1px solid rgba(255,255,255,0.28)',
            borderRadius: 4,
            padding: '0 2px',
            background: 'rgba(12,10,12,0.96)',
            color: '#f9fafb',
            fontSize: 10,
            lineHeight: 1,
          }}
        >
          <option value={HYPERBEAM_MODES.original}>Legacy</option>
          <option value={HYPERBEAM_MODES.hyperbeam}>HyperBEAM</option>
        </select>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            setOpen(true);
            setMaximizedSegment(null);
            sectionRestoreRef.current = null;
            setMaximized((value) => !value);
          }}
          title={maximized ? 'Restore console' : 'Maximize console'}
          style={headerIconButtonStyle}
        >
          {maximized ? 'restore' : 'maximize'}
        </button>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            setOpen(false);
            setMaximized(false);
            setMaximizedSegment(null);
            sectionRestoreRef.current = null;
          }}
          title="Minimize console"
          style={headerIconButtonStyle}
        >
          minimize
        </button>
      </div>
      {open && (
        <>
          <div style={{ padding: '8px 9px 0' }}>
            <div style={{ overflowWrap: 'anywhere', marginBottom: 8, color: 'rgba(255,255,255,0.72)' }}>
              {modeEndpointLabel(mode)}
            </div>
          </div>
          <div
            style={{ display: 'flex', minHeight: 0, flex: '1 1 auto', borderTop: '1px solid rgba(255,255,255,0.12)' }}
          >
            {displayedSegments.trace && (
              <div style={segmentPanelStyle(activeSegmentCount)}>
                <SectionHeader
                  title="Trace"
                  tinted
                  maximized={maximizedSegment === 'trace'}
                  onToggleMaximize={() => toggleMaximizedSegment('trace')}
                />
                <ClaimTrace events={events} onActiveTraceChange={onActiveTraceChange} />
              </div>
            )}
            {displayedSegments.requests && (
              <div style={segmentPanelStyle(activeSegmentCount)}>
                <SectionHeader
                  title="Requests"
                  detail={`${requestFilteredEvents.length}/${focusedEvents.length}`}
                  maximized={maximizedSegment === 'requests'}
                  onToggleMaximize={() => toggleMaximizedSegment('requests')}
                />
                <div style={{ minHeight: 0, overflow: 'auto' }}>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: '10px 9px 8px' }}>
                    {FILTERS.map((filter) => {
                      const active = filter.key === 'all' ? activeFilters.size === 0 : activeFilters.has(filter.key);
                      const disabled = filterDisabledInMode(filter.key, mode);
                      const focusedCount = focusedFilterCounts[filter.key] || 0;
                      const globalCount = filterCounts[filter.key] || 0;
                      const traceActive = Boolean(activeTrace && focusedCount > 0);
                      return (
                        <button
                          key={filter.key}
                          type="button"
                          disabled={disabled}
                          onClick={() => !disabled && toggleFilter(filter.key)}
                          title={
                            disabled
                              ? `${filter.label} disabled in ${modeLabel(mode)}`
                              : active
                                ? `Remove ${filter.label} filter`
                                : `Filter ${filter.label}`
                          }
                          style={{
                            border: `1px solid ${
                              disabled
                                ? 'rgba(255,255,255,0.12)'
                                : active || traceActive
                                  ? filter.color
                                  : 'rgba(255,255,255,0.22)'
                            }`,
                            borderRadius: 4,
                            padding: '1px 6px',
                            background: disabled
                              ? 'rgba(255,255,255,0.025)'
                              : active
                                ? 'rgba(255,255,255,0.12)'
                                : traceActive
                                  ? traceFilterBackground(filter.color)
                                  : 'rgba(255,255,255,0.05)',
                            color: disabled ? 'rgba(255,255,255,0.28)' : filter.color,
                            cursor: disabled ? 'default' : 'pointer',
                            font: 'inherit',
                            fontWeight: traceActive ? 700 : 400,
                            textDecoration: disabled ? 'line-through' : 'none',
                          }}
                        >
                          {filter.label} {activeTrace ? focusedCount : globalCount}
                        </button>
                      );
                    })}
                    <button
                      type="button"
                      onClick={copyEvents}
                      disabled={events.length === 0}
                      title="Copy HyperBEAM log"
                      style={{
                        marginLeft: 'auto',
                        border: '1px solid rgba(255,255,255,0.28)',
                        borderRadius: 4,
                        padding: '1px 6px',
                        background: copied ? '#de0050' : 'rgba(255,255,255,0.08)',
                        color: '#f9fafb',
                        cursor: events.length === 0 ? 'default' : 'pointer',
                        font: 'inherit',
                        opacity: events.length === 0 ? 0.55 : 1,
                      }}
                    >
                      {copied ? 'copied' : 'copy'}
                    </button>
                    <button
                      type="button"
                      onClick={copyRelevantEvents}
                      disabled={events.length === 0}
                      title="Copy only the entries needed for debugging"
                      style={{
                        border: '1px solid rgba(255,255,255,0.28)',
                        borderRadius: 4,
                        padding: '1px 6px',
                        background: copiedRelevant ? '#de0050' : 'rgba(255,255,255,0.08)',
                        color: '#f9fafb',
                        cursor: events.length === 0 ? 'default' : 'pointer',
                        font: 'inherit',
                        opacity: events.length === 0 ? 0.55 : 1,
                      }}
                    >
                      {copiedRelevant ? 'copied' : 'copy fix'}
                    </button>
                  </div>
                  <div ref={logRef} style={{ padding: '0 9px 9px', minHeight: 0 }}>
                    <div
                      style={{
                        position: 'sticky',
                        top: 0,
                        zIndex: 1,
                        display: 'grid',
                        gap: 4,
                        paddingBottom: 6,
                        background: 'rgba(12, 10, 12, 0.96)',
                      }}
                    >
                      <div
                        style={{
                          display: 'grid',
                          alignItems: 'center',
                          width: '100%',
                          boxSizing: 'border-box',
                        }}
                      >
                        <input
                          type="search"
                          value={requestFilterText}
                          onChange={(event) => setRequestFilterText(event.currentTarget.value)}
                          placeholder="Filter full request objects"
                          spellCheck={false}
                          style={{
                            gridArea: '1 / 1',
                            width: '100%',
                            boxSizing: 'border-box',
                            border: '1px solid rgba(255,255,255,0.18)',
                            borderRadius: 4,
                            padding: requestFilterText ? '4px 32px 4px 6px' : '4px 6px',
                            background: 'rgba(0,0,0,0.28)',
                            color: '#f9fafb',
                            font: 'inherit',
                            outline: 'none',
                          }}
                        />
                        {requestFilterText && (
                          <button
                            type="button"
                            onClick={() => setRequestFilterText('')}
                            title="Clear request filter"
                            style={{
                              gridArea: '1 / 1',
                              justifySelf: 'end',
                              zIndex: 1,
                              width: 20,
                              height: 20,
                              marginRight: 4,
                              border: '1px solid rgba(255,255,255,0.18)',
                              borderRadius: 4,
                              padding: 0,
                              background: 'rgba(255,255,255,0.08)',
                              color: 'rgba(255,255,255,0.72)',
                              cursor: 'pointer',
                              font: 'inherit',
                              lineHeight: '18px',
                              textAlign: 'center',
                            }}
                          >
                            ×
                          </button>
                        )}
                      </div>
                      {requestFilterText.trim() && (
                        <div style={{ color: 'rgba(255,255,255,0.52)' }}>
                          object filter · {requestFilteredEvents.length}/{focusedEvents.length} calls
                        </div>
                      )}
                    </div>
                    {events.length === 0 && (
                      <div style={{ color: 'rgba(255,255,255,0.62)' }}>waiting for {modeWaitLabel(mode)} calls</div>
                    )}
                    {events.length !== 0 && requestFilteredEvents.length === 0 && (
                      <div style={{ color: 'rgba(255,255,255,0.62)' }}>
                        {requestFilterNeedles.length
                          ? `no calls match "${requestFilterText.trim()}"`
                          : activeTrace
                            ? `no calls match ${activeTrace.label} with the active filters`
                            : 'no calls match the active filters'}
                      </div>
                    )}
                    {activeTrace && focusedEvents.length !== visibleEvents.length && focusedEvents.length !== 0 && (
                      <div style={{ color: '#0ea5e9', marginBottom: 4 }}>
                        focused on {activeTrace.label} · {focusedEvents.length}/{visibleEvents.length} calls
                      </div>
                    )}
                    {requestFilteredEvents.map((event) => {
                      const index = events.indexOf(event);
                      const isExpanded = expanded[index];
                      const isSelected = selectedEventIndex === index && isExpanded;
                      return (
                        <div
                          key={`${event.time}-${event.label}-${index}`}
                          style={{
                            marginTop: 4,
                            border: isSelected ? '1px solid rgba(14,165,233,0.72)' : '1px solid transparent',
                            borderRadius: 4,
                            background: isSelected ? 'rgba(14,165,233,0.12)' : 'transparent',
                          }}
                        >
                          <button
                            type="button"
                            onClick={() => {
                              if (isExpanded) {
                                setExpanded((current) => ({ ...current, [index]: false }));
                                setSelectedEventIndex((current) => (current === index ? null : current));
                              } else {
                                setExpanded((current) => ({ ...current, [index]: true }));
                                setSelectedEventIndex(index);
                              }
                            }}
                            style={{
                              width: '100%',
                              border: 0,
                              padding: '2px 4px',
                              background: 'transparent',
                              color: 'rgba(255,255,255,0.84)',
                              cursor: 'pointer',
                              font: 'inherit',
                              textAlign: 'left',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            <strong
                              style={{
                                color: eventColor(event),
                              }}
                            >
                              {isExpanded ? '-' : '+'}
                            </strong>{' '}
                            <strong
                              style={{
                                color: eventColor(event),
                              }}
                            >
                              {event.time}
                            </strong>{' '}
                            {event.label} {eventSummary(event, mode)}
                          </button>
                          {isExpanded && <RequestDetail event={event} eventIndex={index} events={events} mode={mode} />}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
            {displayedSegments.graph && (
              <ArchitecturePanel
                events={events}
                mode={mode}
                activeSegmentCount={activeSegmentCount}
                activeTrace={activeTrace}
                selectedEvent={selectedEvent}
                selectedEventIndex={selectedEventIndex}
                maximized={maximizedSegment === 'graph'}
                onToggleMaximize={() => toggleMaximizedSegment('graph')}
              />
            )}
          </div>
        </>
      )}
    </div>
  );
}

function RequestDetail({
  event,
  eventIndex,
  events,
  mode,
}: {
  event: HyperbeamDebugEvent;
  eventIndex: number;
  events: Array<HyperbeamDebugEvent>;
  mode: HyperbeamMode;
}) {
  const data = mergedRequestDetailData(event, eventIndex, events);
  const responsePeer = findRequestLifecyclePeer(event, eventIndex, events);
  const responseMissingText =
    event.label === 'request' && !responsePeer ? 'no matching response event captured yet' : undefined;
  const route = routeSummary(data, mode);
  const statusColor = isFailedEvent(event) ? '#ff4d7d' : data.status ? '#22c55e' : 'rgba(255,255,255,0.72)';
  const timing = pruneEmpty({
    elapsedMs: data.elapsedMs,
    firstSeen: data.firstSeen,
    lastSeen: data.lastSeen,
    repeatCount: data.repeatCount,
  });

  return (
    <div
      style={{
        display: 'grid',
        gap: 8,
        margin: '4px 0 8px',
        padding: 8,
        border: '1px solid rgba(255,255,255,0.12)',
        borderRadius: 4,
        background: 'rgba(255,255,255,0.035)',
      }}
    >
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
          gap: 6,
        }}
      >
        <Metric label="Method" value={data.method || 'GET'} />
        <Metric label="Status" value={data.status || event.level} color={statusColor} />
        <Metric label="Layer" value={data.sourceLayer || data.deviceLayer || nativeLayer(event) || 'unknown'} />
        <Metric label="Time" value={data.elapsedMs !== undefined ? `${data.elapsedMs}ms` : data.time || event.time} />
      </div>
      <DetailSection title="Route" value={route} />
      <DetailSection title="URL" value={requestUrlDetail(data)} />
      <DetailSection title="Request Headers" value={data.requestHeaders} empty="no captured request headers" />
      <DetailSection title="Request Body" value={data.requestBody} empty="no request body" />
      <DetailSection
        title="Response Headers"
        value={data.responseHeaders}
        empty={responseMissingText || 'no captured response headers'}
      />
      <DetailSection
        title="Response Body"
        value={data.body ?? data.bodyCapture}
        empty={responseMissingText || 'no response body captured'}
      />
      <DetailSection title="Timing" value={timing} empty="no timing detail" />
      <DetailSection title="Raw Event" value={{ ...event, data }} />
    </div>
  );
}

function readStoredBoolean(key: string, fallback: boolean) {
  if (typeof window === 'undefined') return fallback;
  const value = window.localStorage.getItem(key);
  if (value === 'true') return true;
  if (value === 'false') return false;
  return fallback;
}

function writeStoredBoolean(key: string, value: boolean) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(key, String(value));
}

function writeStoredJson(key: string, value: any) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(key, JSON.stringify(value));
}

function readStoredSegments() {
  if (typeof window === 'undefined') return DEFAULT_VISIBLE_SEGMENTS;

  try {
    const parsed = JSON.parse(window.localStorage.getItem(CONSOLE_SEGMENTS_STORAGE_KEY) || 'null');
    const segments = {
      graph: typeof parsed?.graph === 'boolean' ? parsed.graph : DEFAULT_VISIBLE_SEGMENTS.graph,
      trace: typeof parsed?.trace === 'boolean' ? parsed.trace : DEFAULT_VISIBLE_SEGMENTS.trace,
      requests: typeof parsed?.requests === 'boolean' ? parsed.requests : DEFAULT_VISIBLE_SEGMENTS.requests,
    };
    return Object.values(segments).some(Boolean) ? segments : DEFAULT_VISIBLE_SEGMENTS;
  } catch (_error) {
    return DEFAULT_VISIBLE_SEGMENTS;
  }
}

function onlyVisibleSegment(segment: SegmentKey): Record<SegmentKey, boolean> {
  return {
    graph: segment === 'graph',
    trace: segment === 'trace',
    requests: segment === 'requests',
  };
}

function SectionHeader({
  detail,
  maximized,
  onToggleMaximize,
  tinted,
  title,
}: {
  detail?: string;
  maximized: boolean;
  onToggleMaximize: () => void;
  tinted?: boolean;
  title: string;
}) {
  return (
    <div
      style={{
        flex: '0 0 auto',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        minHeight: 28,
        width: '100%',
        boxSizing: 'border-box',
        padding: '6px 9px',
        borderBottom: '1px solid rgba(255,255,255,0.1)',
        background: tinted ? 'rgba(255,255,255,0.025)' : 'transparent',
        color: 'rgba(255,255,255,0.78)',
      }}
    >
      <strong style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {title}
      </strong>
      {detail && <span style={{ color: 'rgba(255,255,255,0.48)' }}>{detail}</span>}
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onToggleMaximize();
        }}
        title={maximized ? `Restore ${title}` : `Maximize ${title}`}
        aria-label={maximized ? `Restore ${title}` : `Maximize ${title}`}
        style={sectionIconButtonStyle}
      >
        <FullscreenIcon exit={maximized} />
      </button>
    </div>
  );
}

function FullscreenIcon({ exit }: { exit: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {exit ? (
        <path
          d="M9 3v6H3M15 3v6h6M9 21v-6H3M15 21v-6h6"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : (
        <path
          d="M9 3H3v6M15 3h6v6M9 21H3v-6M15 21h6v-6"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
    </svg>
  );
}

function ArchitecturePanel({
  events,
  mode,
  activeSegmentCount,
  activeTrace,
  selectedEvent,
  selectedEventIndex,
  maximized,
  onToggleMaximize,
}: {
  events: Array<HyperbeamDebugEvent>;
  mode: HyperbeamMode;
  activeSegmentCount: number;
  activeTrace: TraceFocus | null;
  selectedEvent: HyperbeamDebugEvent | null;
  selectedEventIndex: number | null;
  maximized: boolean;
  onToggleMaximize: () => void;
}) {
  const [zoom, setZoom] = React.useState(1);
  const graphEvents = events.filter((event) => !isDebugTraceProbe(event.data || {}));
  const graph = architectureGraph(graphEvents, mode);
  const selectedGraphEvents =
    selectedEvent && selectedEventIndex !== null
      ? lifecycleEventsForSelection(selectedEvent, selectedEventIndex, events)
      : [];
  const activeTraceGraphEvents = activeTrace
    ? events.filter(
        (event) =>
          eventMatchesTraceGraphFocus(event, activeTrace) &&
          !(isNativeUploadTraceFocus(activeTrace) && isDebugTraceProbe(event.data || {}))
      )
    : [];
  const displayGraph = selectedGraphEvents.length
    ? architectureGraph(selectedGraphEvents, mode)
    : activeTrace
      ? architectureGraph(activeTraceGraphEvents, mode)
      : graph;
  const selectedRoute = selectedEvent
    ? routeSummary(mergedRequestDetailData(selectedEvent, selectedEventIndex || 0, events), mode)
    : null;
  const isAuthTraceFocus = Boolean(!selectedEvent && activeTrace?.kind === 'auth');
  const hasArweaveActivity = displayGraph.arweaveEvents > 0;
  const hasSsr = displayGraph.ssrEvents > 0;
  const hasClaimRead =
    !isAuthTraceFocus &&
    (displayGraph.deviceEvents > 0 ||
      displayGraph.cacheEvents > 0 ||
      displayGraph.legacyEvents > 0 ||
      displayGraph.rangeEvents > 0 ||
      displayGraph.arweaveEvents > 0);
  const showClaimPath = hasClaimRead;
  const showAuthPath = displayGraph.authEvents > 0;
  const showLegacyPath = showClaimPath && displayGraph.legacyEvents > 0;
  const showMediaPath = showClaimPath && displayGraph.rangeEvents > 0;
  const deviceRows = displayGraph.deviceNames.length ? displayGraph.deviceNames : ['No device calls yet'];
  const activeTraceNativeUpload = isNativeUploadTraceFocus(activeTrace);
  const selectedPath = selectedGraphEvents.length
    ? architectureSelectedPath(selectedGraphEvents, deviceRows, selectedEventIndex, events, mode)
    : activeTraceGraphEvents.length || activeTraceNativeUpload
      ? architectureTracePath(displayGraph, deviceRows, activeTrace)
      : null;
  const graphHeight = Math.max(600, architectureDeviceY(deviceRows.length - 1) + 106);
  const hasGraphFocus = Boolean(selectedEvent || activeTrace);
  const showStaticBackendEdges = !selectedPath;
  const nodeActive = (node: string, fallback: boolean) => (selectedPath ? selectedPath.nodes.has(node) : fallback);
  const nodeFaded = (node: string, fallback: boolean) => (selectedPath ? !selectedPath.nodes.has(node) : fallback);

  return (
    <div
      style={{
        ...segmentPanelStyle(activeSegmentCount),
        minHeight: 0,
        overflow: 'hidden',
        borderRight: '1px solid rgba(255,255,255,0.12)',
        background: 'rgba(255,255,255,0.025)',
      }}
    >
      <SectionHeader title="Graph" maximized={maximized} onToggleMaximize={onToggleMaximize} />
      <div
        style={{
          display: 'grid',
          gap: 8,
          minWidth: 0,
          width: '100%',
          minHeight: 0,
          overflow: 'auto',
          padding: '8px 9px 9px',
          boxSizing: 'border-box',
        }}
      >
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(92px, 1fr))', gap: 6 }}>
          <Metric label="Mode" value={modeLabel(mode)} />
          <Metric label="HyperBEAM" value={displayGraph.hyperbeamEvents} color="#0ea5e9" />
          <Metric label="Auth" value={displayGraph.authEvents} color="#22c55e" />
          <Metric label="Cache/store" value={displayGraph.cacheEvents} color="#facc15" />
          <Metric
            label="Legacy Odysee"
            value={displayGraph.legacyEvents + displayGraph.fallbackEvents}
            color="#94a3b8"
          />
          <Metric label="Media store" value={displayGraph.rangeEvents} color="#fb7185" />
          <Metric label="Arweave store" value={displayGraph.arweaveEvents} color="#64748b" />
        </div>
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 10,
            color: 'rgba(255,255,255,0.68)',
            overflowWrap: 'anywhere',
          }}
        >
          <span>
            devices observed: <span style={{ color: '#0ea5e9' }}>{displayGraph.deviceNames.length}</span>
          </span>
          {selectedEvent && (
            <span style={{ color: '#0ea5e9' }}>
              highlighting {selectedEvent.label} {selectedRoute?.devicePath || selectedRoute?.nativePath || ''}
            </span>
          )}
          {!selectedEvent && activeTrace && <span style={{ color: '#0ea5e9' }}>highlighting {activeTrace.label}</span>}
        </div>
        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            color: 'rgba(255,255,255,0.68)',
            userSelect: 'none',
          }}
        >
          <span style={{ flex: '0 0 auto' }}>zoom {Math.round(zoom * 100)}%</span>
          <input
            type="range"
            min="100"
            max="200"
            step="5"
            value={Math.round(zoom * 100)}
            onChange={(event) => setZoom(Number(event.currentTarget.value) / 100)}
            style={{ flex: '1 1 80px', minWidth: 0 }}
          />
        </label>
        <div
          style={{
            position: 'relative',
            width: `${zoom * 100}%`,
            aspectRatio: `1540 / ${graphHeight}`,
          }}
        >
          <svg
            viewBox={`0 0 1540 ${graphHeight}`}
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              width: '100%',
              height: '100%',
              maxWidth: 'none',
              display: 'block',
            }}
          >
            <defs>
              <marker id="hb-arrow-default" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto">
                <path d="M0,0 L0,6 L8,3 z" fill="rgba(255,255,255,0.72)" />
              </marker>
              {ARCHITECTURE_ARROW_MARKERS.map((marker) => (
                <marker
                  key={marker.id}
                  id={marker.id}
                  markerWidth="10"
                  markerHeight="10"
                  refX="8"
                  refY="3"
                  orient="auto"
                >
                  <path d="M0,0 L0,6 L8,3 z" fill={marker.color} />
                </marker>
              ))}
            </defs>
            <ArchitectureNode
              x={30}
              y={250}
              w={170}
              h={82}
              title="Browser UI"
              detail="Odysee React app"
              color="#e879f9"
              active={nodeActive('ui', hasGraphFocus)}
            />
            <ArchitectureNode
              x={250}
              y={124}
              w={190}
              h={82}
              title="SDK facade"
              detail="lbry.ts / hyperbeam.ts"
              color="#38bdf8"
              active={nodeActive('sdk', showClaimPath)}
              faded={nodeFaded('sdk', !showClaimPath)}
            />
            <ArchitectureNode
              x={250}
              y={374}
              w={190}
              h={82}
              title="SSR proxy"
              detail="/$/api routes"
              color="#38bdf8"
              active={nodeActive('ssr', showAuthPath || hasSsr)}
              faded={nodeFaded('ssr', !showAuthPath && !hasSsr)}
            />
            <ArchitectureNode
              x={500}
              y={250}
              w={170}
              h={82}
              title="HyperBEAM"
              detail="router / runtime"
              color="#0ea5e9"
              active={nodeActive('hyperbeam', hasGraphFocus && displayGraph.hyperbeamEvents > 0)}
              faded={nodeFaded('hyperbeam', !displayGraph.hyperbeamEvents)}
            />
            {deviceRows.map((device, index) => (
              <ArchitectureNode
                key={device}
                x={720}
                y={architectureDeviceY(index)}
                w={280}
                h={70}
                title={device}
                detail={displayGraph.devices[device] ? `${displayGraph.devices[device]} calls` : 'not observed yet'}
                color="#0ea5e9"
                active={nodeActive(`device:${device}`, Boolean(displayGraph.devices[device]))}
                faded={nodeFaded(`device:${device}`, !displayGraph.devices[device])}
              />
            ))}
            <ArchitectureNode
              x={500}
              y={424}
              w={210}
              h={82}
              title="Auth hook"
              detail="cookie/token -> signer"
              color="#22c55e"
              active={nodeActive('auth', showAuthPath)}
              faded={nodeFaded('auth', !showAuthPath)}
            />
            <ArchitectureNode
              x={1040}
              y={64}
              w={210}
              h={82}
              title="cache@1.0"
              detail="generic read/list/write"
              color="#facc15"
              active={nodeActive('cache', showClaimPath && displayGraph.cacheEvents > 0)}
              faded={nodeFaded('cache', !showClaimPath)}
            />
            <ArchitectureNode
              x={1040}
              y={214}
              w={210}
              h={82}
              title="Store stack"
              detail="local, Odysee, Arweave, gateways"
              color="#facc15"
              active={nodeActive('store', showClaimPath && hasClaimRead)}
              faded={nodeFaded('store', !showClaimPath)}
            />
            <ArchitectureNode
              x={1040}
              y={414}
              w={210}
              h={82}
              title="Upload device"
              detail="chunks, manifest, writes"
              color="#0ea5e9"
              active={nodeActive('upload', displayGraph.uploadEvents > 0)}
              faded={nodeFaded('upload', hasGraphFocus && displayGraph.uploadEvents === 0)}
            />
            <ArchitectureNode
              x={1340}
              y={112}
              w={160}
              h={82}
              title="Legacy Odysee"
              detail="API / chain / blobs"
              color="#94a3b8"
              active={nodeActive('legacy', showLegacyPath)}
              faded={nodeFaded('legacy', !showClaimPath)}
            />
            <ArchitectureNode
              x={1340}
              y={284}
              w={160}
              h={82}
              title="Arweave store"
              detail={hasArweaveActivity ? 'observed lookup' : 'not wired yet'}
              color="#64748b"
              active={nodeActive('arweave', showClaimPath && displayGraph.arweaveEvents > 0)}
              faded={nodeFaded('arweave', !showClaimPath || !hasArweaveActivity)}
            />
            <ArchitectureNode
              x={1340}
              y={456}
              w={160}
              h={82}
              title="Media store"
              detail="chunks/range bytes"
              color="#fb7185"
              active={nodeActive('media', showMediaPath)}
              faded={nodeFaded('media', !showClaimPath)}
            />
            {(!hasGraphFocus || displayGraph.sdkEvents > 0) && (
              <ArchitectureEdge
                x1={200}
                y1={280}
                x2={250}
                y2={165}
                label={`${displayGraph.sdkEvents} sdk`}
                active={displayGraph.sdkEvents > 0}
                faded={displayGraph.sdkEvents === 0}
              />
            )}
            <ArchitectureEdge
              x1={200}
              y1={304}
              x2={250}
              y2={415}
              label={`${displayGraph.ssrEvents} proxy`}
              active={showAuthPath || hasSsr}
              faded={!showAuthPath && !hasSsr}
              color="#0ea5e9"
            />
            {(!hasGraphFocus || (displayGraph.deviceEvents > 0 && !isAuthTraceFocus)) && (
              <ArchitectureEdge
                x1={440}
                y1={165}
                x2={500}
                y2={280}
                label={`${displayGraph.deviceEvents} routed`}
                active={displayGraph.deviceEvents > 0}
                faded={displayGraph.deviceEvents === 0}
              />
            )}
            {!selectedPath &&
              deviceRows.map((device, index) => (
                <ArchitectureEdge
                  key={`${device}-edge`}
                  x1={670}
                  y1={291}
                  x2={720}
                  y2={architectureDeviceY(index) + 35}
                  label={displayGraph.devices[device] ? `${displayGraph.devices[device]}` : 'none'}
                  active={Boolean(displayGraph.devices[device])}
                  faded={!displayGraph.devices[device]}
                />
              ))}
            {!hasGraphFocus &&
              deviceRows.map((device, index) => (
                <ArchitectureFlow
                  key={`${device}-store-flow`}
                  active={showClaimPath && Boolean(displayGraph.devices[device])}
                  color="#facc15"
                  faded={!showClaimPath || !displayGraph.devices[device]}
                  points={architectureDeviceStorePath(index, deviceRows.length)}
                />
              ))}
            {(!hasGraphFocus || showAuthPath) && (
              <>
                <ArchitectureEdge
                  x1={440}
                  y1={415}
                  x2={500}
                  y2={465}
                  label={`${displayGraph.authEvents} auth`}
                  active={showAuthPath}
                  faded={!showAuthPath}
                  color="#22c55e"
                />
              </>
            )}
            {showStaticBackendEdges && (!hasGraphFocus || displayGraph.cacheEvents > 0) && (
              <ArchitectureEdge
                x1={1145}
                y1={146}
                x2={1145}
                y2={214}
                label="cache miss"
                active={showClaimPath && displayGraph.cacheEvents > 0}
                faded={!showClaimPath || displayGraph.cacheEvents === 0}
                color="#facc15"
              />
            )}
            {showStaticBackendEdges && (!hasGraphFocus || showLegacyPath) && (
              <ArchitectureEdge
                x1={1250}
                y1={255}
                x2={1340}
                y2={153}
                label={`${displayGraph.legacyEvents} legacy store`}
                active={showLegacyPath}
                faded={!showClaimPath}
                color="#94a3b8"
              />
            )}
            {showStaticBackendEdges && (!hasGraphFocus || hasArweaveActivity) && (
              <ArchitectureEdge
                x1={1250}
                y1={255}
                x2={1340}
                y2={325}
                label="arweave store"
                active={showClaimPath && displayGraph.arweaveEvents > 0}
                faded={!showClaimPath || !hasArweaveActivity}
                color="#64748b"
              />
            )}
            {showStaticBackendEdges && (!hasGraphFocus || showMediaPath) && (
              <ArchitectureEdge
                x1={1250}
                y1={255}
                x2={1340}
                y2={497}
                label="media bytes"
                active={showMediaPath}
                faded={!showClaimPath}
                color="#fb7185"
              />
            )}
            {showStaticBackendEdges && displayGraph.uploadEvents > 0 && (
              <ArchitectureEdge
                x1={710}
                y1={465}
                x2={1040}
                y2={455}
                label={`${displayGraph.uploadEvents} upload`}
                active
                color="#0ea5e9"
              />
            )}
            {selectedPath?.flows.map((flow, index) => (
              <ArchitectureSelectedFlow key={`${flow.label}-${index}`} {...flow} />
            ))}
          </svg>
        </div>
        <DetailSection title="Recent Route Samples" value={displayGraph.samples} empty="no routes observed yet" />
      </div>
    </div>
  );
}

function Metric({ label, value, color }: { label: string; value: any; color?: string }) {
  return (
    <div
      style={{
        border: '1px solid rgba(255,255,255,0.12)',
        borderRadius: 4,
        padding: 6,
        background: 'rgba(0,0,0,0.14)',
      }}
    >
      <div style={{ color: 'rgba(255,255,255,0.48)', fontSize: 10 }}>{label}</div>
      <div style={{ color: color || 'rgba(255,255,255,0.88)', overflowWrap: 'anywhere' }}>{String(value ?? '-')}</div>
    </div>
  );
}

function DetailSection({ title, value, empty }: { title: string; value: any; empty?: string }) {
  const hasValue =
    value !== undefined &&
    value !== null &&
    value !== '' &&
    !(typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0);

  return (
    <details open={DEFAULT_OPEN_DETAIL_SECTIONS.has(title)}>
      <summary style={{ cursor: 'pointer', color: 'rgba(255,255,255,0.72)' }}>{title}</summary>
      <pre
        style={{
          margin: '4px 0 0',
          maxHeight: 260,
          overflow: 'auto',
          whiteSpace: 'pre-wrap',
          overflowWrap: 'anywhere',
          color: hasValue ? 'rgba(255,255,255,0.82)' : 'rgba(255,255,255,0.42)',
          background: 'rgba(0,0,0,0.18)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 4,
          padding: 6,
        }}
      >
        {hasValue ? formatDetail(value) : empty || 'empty'}
      </pre>
    </details>
  );
}

const DEFAULT_OPEN_DETAIL_SECTIONS = new Set(['Route', 'URL', 'Request Headers', 'Response Headers', 'Response Body']);

function requestUrlDetail(data: any) {
  return pruneEmpty({
    url: data.url,
    parts: data.urlParts,
  });
}

function mergedRequestDetailData(event: HyperbeamDebugEvent, eventIndex: number, events: Array<HyperbeamDebugEvent>) {
  const data = sanitizeHyperbeamDebugValue(event.data || {});
  const peer = findRequestLifecyclePeer(event, eventIndex, events);
  const peerData = peer ? sanitizeHyperbeamDebugValue(peer.data || {}) : {};

  return pruneEmpty({
    ...peerData,
    ...data,
    method: data.method || peerData.method,
    status: data.status || peerData.status,
    ok: data.ok ?? peerData.ok,
    elapsedMs: data.elapsedMs ?? peerData.elapsedMs,
    sourceLayer: data.sourceLayer || peerData.sourceLayer,
    sourceReason: data.sourceReason || peerData.sourceReason,
    sourceAlg: data.sourceAlg || peerData.sourceAlg,
    responseDevice: data.responseDevice || peerData.responseDevice,
    requestHeaders: data.requestHeaders || peerData.requestHeaders,
    requestBody: data.requestBody || peerData.requestBody,
    responseHeaders: data.responseHeaders || peerData.responseHeaders,
    body: data.body ?? peerData.body,
    bodyCapture: data.bodyCapture || peerData.bodyCapture,
    contentType: data.contentType || peerData.contentType,
    contentLength: data.contentLength || peerData.contentLength,
    contentRange: data.contentRange || peerData.contentRange,
    acceptRanges: data.acceptRanges || peerData.acceptRanges,
    mediaSource: data.mediaSource || peerData.mediaSource,
    mediaVerification: data.mediaVerification || peerData.mediaVerification,
    mediaVerificationLimitations: data.mediaVerificationLimitations || peerData.mediaVerificationLimitations,
    mediaMs: data.mediaMs || peerData.mediaMs,
    mediaBlobs: data.mediaBlobs || peerData.mediaBlobs,
    detailMergedFrom: peer ? peer.label : undefined,
  });
}

function findRequestLifecyclePeer(event: HyperbeamDebugEvent, eventIndex: number, events: Array<HyperbeamDebugEvent>) {
  const wantLabel = event.label === 'request' ? 'response' : isResponseLikeEvent(event) ? 'request' : undefined;
  if (!wantLabel) return undefined;

  const step = wantLabel === 'response' ? 1 : -1;
  for (let index = eventIndex + step; index >= 0 && index < events.length; index += step) {
    const candidate = events[index];
    if (
      (wantLabel === 'response' ? isResponseLikeEvent(candidate) : candidate.label === wantLabel) &&
      eventsShareRequestLifecycle(event, candidate)
    )
      return candidate;
    if (candidate.label === event.label && eventsShareRequestLifecycle(event, candidate)) return undefined;
  }

  return undefined;
}

function lifecycleEventsForSelection(
  event: HyperbeamDebugEvent,
  eventIndex: number,
  events: Array<HyperbeamDebugEvent>
) {
  const peer = findRequestLifecyclePeer(event, eventIndex, events);
  return peer ? [event, peer] : [event];
}

function focusedEventsWithLifecyclePeers(
  visibleEvents: Array<HyperbeamDebugEvent>,
  events: Array<HyperbeamDebugEvent>,
  focus: TraceFocus
) {
  const included = new Set<HyperbeamDebugEvent>();
  const visibleSet = new Set(visibleEvents);

  visibleEvents.forEach((event) => {
    if (!eventMatchesTraceFocus(event, focus)) return;

    included.add(event);
    const eventIndex = events.indexOf(event);
    if (eventIndex === -1) return;

    const peer = findRequestLifecyclePeer(event, eventIndex, events);
    if (peer && visibleSet.has(peer)) included.add(peer);
  });

  return visibleEvents.filter((event) => included.has(event));
}

function eventsShareRequestLifecycle(left: HyperbeamDebugEvent, right: HyperbeamDebugEvent) {
  const leftData = left.data || {};
  const rightData = right.data || {};
  if (leftData.callId || rightData.callId) return Boolean(leftData.callId && leftData.callId === rightData.callId);

  const leftPath = String(leftData.devicePath || leftData.nativePath || leftData.urlParts?.path || '');
  const rightPath = String(rightData.devicePath || rightData.nativePath || rightData.urlParts?.path || '');
  const leftRequestKey = String(leftData.requestKey || '');
  const rightRequestKey = String(rightData.requestKey || '');

  if (leftData.pagePath && rightData.pagePath && leftData.pagePath !== rightData.pagePath) return false;
  if (leftPath && rightPath && leftPath !== rightPath) return false;
  if (leftRequestKey || rightRequestKey)
    return Boolean(leftRequestKey && rightRequestKey && leftRequestKey === rightRequestKey);

  const leftDevice = String(leftData.device || leftData.responseDevice || '');
  const rightDevice = String(rightData.device || rightData.responseDevice || '');
  if (leftDevice && rightDevice && leftDevice !== rightDevice) return false;

  return Boolean(leftPath || leftDevice);
}

function ArchitectureNode({
  active,
  details,
  faded,
  x,
  y,
  w,
  h,
  title,
  detail,
  color,
}: {
  active?: boolean;
  details?: Array<string>;
  faded?: boolean;
  x: number;
  y: number;
  w: number;
  h: number;
  title: string;
  detail?: string;
  color: string;
}) {
  return (
    <g opacity={faded ? 0.3 : 1}>
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx={6}
        fill={active ? activeFill(color) : 'rgba(0,0,0,0.28)'}
        stroke={color}
        strokeWidth={active ? 4 : 2}
      />
      <text x={x + 12} y={y + 30} fill="#f9fafb" fontSize="15" fontWeight="700">
        {limitString(title, Math.max(12, Math.floor((w - 24) / 8)))}
      </text>
      {(details || [detail || '']).map((line, index) => (
        <text key={`${line}-${index}`} x={x + 12} y={y + 55 + index * 15} fill="rgba(255,255,255,0.68)" fontSize="11">
          {limitString(line, Math.max(12, Math.floor((w - 24) / 6)))}
        </text>
      ))}
    </g>
  );
}

function architectureDeviceY(index: number) {
  return 28 + index * 92;
}

function architectureDeviceStorePath(index: number, count: number) {
  const y = architectureDeviceY(index) + 35;
  const entryX = Math.round(1054 + ((index + 1) * 172) / (count + 1));
  return `1000,${y} ${entryX},${y} ${entryX},146`;
}

function architectureTracePath(
  graph: ReturnType<typeof architectureGraph>,
  deviceRows: Array<string>,
  activeTrace: TraceFocus | null
) {
  const nodes = new Set<string>(['ui']);
  const flows: Array<{ color: string; label: string; points: string }> = [];
  const isAuth = activeTrace?.kind === 'auth' || graph.authEvents > 0;
  const isNativeUpload = isNativeUploadTraceFocus(activeTrace);
  const hasDevice = deviceRows.length > 0 && deviceRows[0] !== 'No device calls yet';
  const device = hasDevice ? deviceRows[0] : '';
  const deviceY = architectureDeviceY(0) + 35;

  if (isAuth) {
    nodes.add('ssr');
    nodes.add('auth');
    if (device) nodes.add(`device:${device}`);
    flows.push({
      color: '#22c55e',
      label: 'auth request',
      points: device
        ? `200,304 250,415 440,415 500,465 585,424 605,424 605,465 710,465 720,${deviceY}`
        : '200,304 250,415 440,415 500,465 585,424 605,424',
    });
    flows.push({
      color: '#22c55e',
      label: 'auth response',
      points: device
        ? `720,${deviceY} 710,465 605,465 605,424 585,424 500,465 440,415 250,415 200,304`
        : '605,424 585,424 500,465 440,415 250,415 200,304',
    });
    return { flows, nodes };
  }

  if (isNativeUpload) {
    nodes.add('ssr');
    nodes.add('store');
    flows.push({
      color: '#facc15',
      label: 'store metadata',
      points: '200,304 250,415 440,415 1040,255',
    });
    flows.push({
      color: '#22c55e',
      label: 'response',
      points: '1040,255 440,415 250,415 200,304',
    });
  }

  if (!isNativeUpload || device) nodes.add('sdk');
  if (graph.hyperbeamEvents > 0) nodes.add('hyperbeam');
  if (device) nodes.add(`device:${device}`);

  if (!isNativeUpload || device) {
    flows.push({
      color: '#0ea5e9',
      label: 'request',
      points: device ? `200,280 250,165 440,165 500,291 670,291 720,${deviceY}` : '200,280 250,165 440,165 500,291',
    });
  }

  if (graph.legacyEvents > 0 || graph.fallbackEvents > 0) {
    nodes.add('store');
    nodes.add('legacy');
    flows.push({
      color: '#94a3b8',
      label: 'legacy store',
      points: device ? `720,${deviceY} 1000,${deviceY} 1040,255 1340,153` : '500,291 1040,255 1340,153',
    });
    flows.push({
      color: '#22c55e',
      label: 'response',
      points: device
        ? `1340,153 1040,255 1000,${deviceY} 720,${deviceY} 670,291 500,291 440,165 250,165 200,280`
        : '1340,153 1040,255 500,291 440,165 250,165 200,280',
    });
  }

  if (graph.rangeEvents > 0) {
    nodes.add('ssr');
    nodes.add('store');
    nodes.add('media');
    flows.push({
      color: '#fb7185',
      label: 'media bytes',
      points: '200,304 250,415 440,415 1040,255 1340,497',
    });
    flows.push({
      color: '#22c55e',
      label: 'response',
      points: '1340,497 1040,255 440,415 250,415 200,304',
    });
  }

  if (graph.legacyEvents === 0 && graph.fallbackEvents === 0 && graph.rangeEvents === 0 && graph.cacheEvents > 0) {
    nodes.add('cache');
    flows.push({
      color: '#facc15',
      label: 'cache',
      points: device ? `720,${deviceY} 1000,${deviceY} 1145,105` : '500,291 1145,105',
    });
    flows.push({
      color: '#22c55e',
      label: 'response',
      points: device
        ? `1145,105 1000,${deviceY} 720,${deviceY} 670,291 500,291 440,165 250,165 200,280`
        : '1145,105 500,291 440,165 250,165 200,280',
    });
  } else if (graph.legacyEvents === 0 && graph.fallbackEvents === 0 && graph.rangeEvents === 0 && device) {
    flows.push({
      color: '#22c55e',
      label: 'response',
      points: `720,${deviceY} 670,291 500,291 440,165 250,165 200,280`,
    });
  }

  return { flows, nodes };
}

function architectureSelectedPath(
  selectedEvents: Array<HyperbeamDebugEvent>,
  deviceRows: Array<string>,
  selectedEventIndex: number | null,
  allEvents: Array<HyperbeamDebugEvent>,
  mode: HyperbeamMode
) {
  const nodes = new Set<string>(['ui']);
  const flows: Array<{ color: string; label: string; points: string }> = [];
  const selectedEventPosition =
    selectedEventIndex !== null ? selectedEventIndex : Math.max(0, selectedEvents.findIndex(isResponseLikeEvent));
  const selected =
    selectedEventIndex !== null
      ? allEvents[selectedEventIndex]
      : selectedEvents[selectedEventPosition] || selectedEvents[0];
  const selectedData =
    selectedEventIndex !== null
      ? mergedRequestDetailData(selected, selectedEventIndex, allEvents)
      : selected?.data || {};
  const selectedDevices = devicesFromEventData(selectedData);
  const selectedDevice = selectedDevices[0] || String(selectedData.device || selectedData.responseDevice || '');
  const deviceIndex = Math.max(0, deviceRows.indexOf(selectedDevice));
  const deviceY = architectureDeviceY(deviceIndex) + 35;
  const path = String(selectedData.devicePath || selectedData.nativePath || selectedData.urlParts?.path || '');
  const sourceLayer = String(selectedData.sourceLayer || '');
  const nativeSource = String(selectedData.nativeSource || '');
  const isUploadRead = isHyperbeamUploadReadPath(path);
  const isUploadMetadata = isHyperbeamUploadMetadataPath(path) || nativeSource === 'upload-index';
  const isAuth = !isUploadRead && Boolean(selectedData.authRequired || sourceLayer.includes('auth'));
  const isSsr = path.includes('/$/api/');
  const frontend = isSsr || isAuth ? 'ssr' : 'sdk';
  const frontendPoint = isUploadRead
    ? '250,415 440,415'
    : frontend === 'ssr'
      ? '250,415 440,415 500,465'
      : '250,165 440,165 500,291';
  const uiPoint = frontend === 'ssr' ? '200,304' : '200,280';
  const hyperbeamPoint = isUploadRead ? '440,415' : frontend === 'ssr' ? '500,465' : '500,291';
  const routePrefix = `${uiPoint} ${frontendPoint}`;
  const responseSuffix = isUploadRead
    ? '440,415 250,415 200,304'
    : frontend === 'ssr'
      ? `${hyperbeamPoint} 440,415 250,415 200,304`
      : `${hyperbeamPoint} 440,165 250,165 200,280`;
  const mediaRange = isMediaRangeEvent(selectedData, path, selectedDevice);
  const hasRequest = selectedEvents.some((event) => event.label === 'request' || event.label === 'request failed');
  const hasResponse = selectedEvents.some(isResponseLikeEvent);
  const isCache = path.includes('~cache@1.0') || nativeSource === 'cache';
  const isUpload =
    path.includes('~odysee-upload@1.0') || (path.includes('/hyperbeam-upload/') && !isUploadRead && !isUploadMetadata);
  const isArweave = path.includes('~arweave') || sourceLayer.includes('arweave');
  const isLegacy =
    !mediaRange &&
    (selectedData.deviceLayer === 'compat-device' || sourceLayer === 'original' || sourceLayer.startsWith('fallback'));
  const selectedFailed = selectedEvents.some(isFailedEvent);
  const backendFlows: Array<{ color: string; label: string; node: string; x: number; y: number; viaStore?: boolean }> =
    [];

  nodes.add(frontend);
  if (mode !== HYPERBEAM_MODES.original && !isUploadRead && !isUploadMetadata) nodes.add('hyperbeam');
  if (isAuth) nodes.add('auth');
  if (selectedDevice) nodes.add(`device:${selectedDevice}`);

  if (isCache) {
    backendFlows.push({ color: '#facc15', label: 'cache', node: 'cache', x: 1145, y: 105 });
  }
  if (mediaRange) {
    backendFlows.push({ color: '#fb7185', label: 'media bytes', node: 'media', x: 1340, y: 497, viaStore: true });
  }
  if (isLegacy) {
    backendFlows.push({ color: '#94a3b8', label: 'legacy', node: 'legacy', x: 1340, y: 153, viaStore: true });
  }
  if (isArweave) {
    backendFlows.push({ color: '#64748b', label: 'arweave', node: 'arweave', x: 1340, y: 325, viaStore: true });
  }
  if (isUploadMetadata) {
    backendFlows.push({ color: '#facc15', label: 'store metadata', node: 'store', x: 1040, y: 255 });
  }
  if (isUpload) {
    backendFlows.push({ color: '#0ea5e9', label: 'upload', node: 'upload', x: 1040, y: 455 });
  }
  backendFlows.forEach((backend) => nodes.add(backend.node));
  if (backendFlows.some((backend) => backend.viaStore)) nodes.add('store');
  if (isUpload) nodes.add('upload');

  if (hasRequest) {
    const requestColor = selectedFailed && !hasResponse ? '#ff4d7d' : isAuth ? '#22c55e' : '#0ea5e9';
    const requestPoints = selectedDevice
      ? isAuth
        ? `${routePrefix} 585,424 605,424 605,465 710,465 720,${deviceY}`
        : `${routePrefix} 670,291 720,${deviceY}`
      : isUpload
        ? `${routePrefix} 710,465 1040,455`
        : mediaRange
          ? `${routePrefix} 1040,255 1340,497`
          : routePrefix;
    flows.push({
      color: requestColor,
      label: selectedFailed && !hasResponse ? 'failed request' : isAuth ? 'auth request' : 'request',
      points: requestPoints,
    });
  }

  if (hasResponse) {
    const primaryBackend = backendFlows[0];
    const responsePoints = primaryBackend
      ? primaryBackend.node === 'upload'
        ? `1040,455 710,465 ${responseSuffix}`
        : !primaryBackend.viaStore
          ? `${primaryBackend.x},${primaryBackend.y} ${hyperbeamPoint} ${responseSuffix}`
          : selectedDevice
            ? `${primaryBackend.x},${primaryBackend.y} 1040,255 1000,${deviceY} 720,${deviceY} 670,291 ${responseSuffix}`
            : `${primaryBackend.x},${primaryBackend.y} 1040,255 ${responseSuffix}`
      : isAuth
        ? `720,${deviceY} 710,465 605,465 605,424 585,424 500,465 440,415 250,415 200,304`
        : selectedDevice
          ? `720,${deviceY} 670,291 ${responseSuffix}`
          : responseSuffix;
    flows.push({
      color: selectedFailed ? '#ff4d7d' : '#22c55e',
      label: selectedFailed ? 'failed response' : 'response',
      points: responsePoints,
    });
  }

  if (selectedDevice && !isAuth) {
    flows.push({
      color: '#0ea5e9',
      label: selectedDevice.replace(/^~/, ''),
      points: `670,291 720,${deviceY}`,
    });
  }

  backendFlows.forEach((backend) => {
    if (!hasRequest) return;
    const points =
      backend.node === 'upload'
        ? `${hyperbeamPoint} 710,465 1040,455`
        : !backend.viaStore
          ? `${hyperbeamPoint} ${backend.x},${backend.y}`
          : selectedDevice
            ? `720,${deviceY} 1000,${deviceY} 1040,255 ${backend.x},${backend.y}`
            : `${hyperbeamPoint} 1040,255 ${backend.x},${backend.y}`;
    flows.push({ color: backend.color, label: backend.label, points });
  });

  return { flows, nodes };
}

function ArchitectureFlow({
  active,
  color,
  faded,
  points,
}: {
  active?: boolean;
  color: string;
  faded?: boolean;
  points: string;
}) {
  return (
    <polyline
      points={points}
      fill="none"
      opacity={faded ? 0.18 : 0.74}
      stroke={color}
      strokeWidth={active ? 3 : 1.5}
      strokeDasharray="5 5"
      markerEnd={architectureArrowMarker(color)}
    />
  );
}

function ArchitectureSelectedFlow({ color, label, points }: { color: string; label: string; points: string }) {
  const parsed = points
    .split(/\s+/)
    .map((point) => point.split(',').map(Number))
    .filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
  const middle = parsed[Math.max(0, Math.floor(parsed.length / 2) - 1)] || [0, 0];

  return (
    <g>
      <polyline
        points={points}
        fill="none"
        opacity={0.96}
        stroke={color}
        strokeWidth={5}
        markerEnd={architectureArrowMarker(color)}
      />
      <rect x={middle[0] - 56} y={middle[1] - 26} width="112" height="18" rx="4" fill={activeLabelFill(color)} />
      <text x={middle[0]} y={middle[1] - 13} fill="#f9fafb" fontSize="10" textAnchor="middle">
        {limitString(label, 18)}
      </text>
    </g>
  );
}

function ArchitectureEdge({
  active,
  color = '#38bdf8',
  faded,
  x1,
  y1,
  x2,
  y2,
  label,
}: {
  active?: boolean;
  color?: string;
  faded?: boolean;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  label: string;
}) {
  const lx = (x1 + x2) / 2;
  const ly = (y1 + y2) / 2 - 7;
  return (
    <g opacity={faded ? 0.25 : 1}>
      <line
        x1={x1}
        y1={y1}
        x2={x2}
        y2={y2}
        stroke={color}
        strokeWidth={active ? 4 : 2}
        markerEnd={architectureArrowMarker(color)}
      />
      <rect
        x={lx - 42}
        y={ly - 13}
        width="84"
        height="18"
        rx="4"
        fill={active ? activeLabelFill(color) : 'rgba(12,10,12,0.88)'}
      />
      <text x={lx} y={ly} fill={active ? '#f9fafb' : 'rgba(255,255,255,0.78)'} fontSize="10" textAnchor="middle">
        {label}
      </text>
    </g>
  );
}

function architectureArrowMarker(color?: string) {
  switch (color) {
    case '#38bdf8':
      return 'url(#hb-arrow-blue)';
    case '#0ea5e9':
      return 'url(#hb-arrow-hyperbeam)';
    case '#22c55e':
      return 'url(#hb-arrow-auth)';
    case '#facc15':
      return 'url(#hb-arrow-cache)';
    case '#94a3b8':
      return 'url(#hb-arrow-legacy)';
    case '#64748b':
      return 'url(#hb-arrow-muted)';
    case '#fb7185':
      return 'url(#hb-arrow-media)';
    case '#c084fc':
      return 'url(#hb-arrow-arweave)';
    case '#e879f9':
      return 'url(#hb-arrow-ui)';
    default:
      return 'url(#hb-arrow-default)';
  }
}

function activeFill(color: string) {
  switch (color) {
    case '#22c55e':
      return 'rgba(34,197,94,0.16)';
    case '#facc15':
      return 'rgba(250,204,21,0.14)';
    case '#94a3b8':
    case '#64748b':
      return 'rgba(148,163,184,0.14)';
    case '#fb7185':
      return 'rgba(251,113,133,0.14)';
    case '#c084fc':
      return 'rgba(192,132,252,0.14)';
    default:
      return 'rgba(14,165,233,0.16)';
  }
}

function activeLabelFill(color: string) {
  switch (color) {
    case '#22c55e':
      return 'rgba(34,197,94,0.84)';
    case '#facc15':
      return 'rgba(202,138,4,0.9)';
    case '#94a3b8':
    case '#64748b':
      return 'rgba(71,85,105,0.94)';
    case '#fb7185':
      return 'rgba(190,18,60,0.9)';
    case '#c084fc':
      return 'rgba(126,34,206,0.9)';
    default:
      return 'rgba(14,165,233,0.88)';
  }
}

function traceFilterBackground(color: string) {
  switch (color) {
    case '#22c55e':
      return 'rgba(34,197,94,0.18)';
    case '#ffb020':
      return 'rgba(255,176,32,0.16)';
    case '#94a3b8':
      return 'rgba(148,163,184,0.16)';
    case '#ff4d7d':
      return 'rgba(255,77,125,0.16)';
    default:
      return 'rgba(14,165,233,0.16)';
  }
}

function routeSummary(data: any, mode: HyperbeamMode) {
  return pruneEmpty({
    mode,
    pagePath: data.pagePath,
    method: data.method,
    url: data.url,
    device: data.device,
    devicePath: data.devicePath,
    deviceLayer: data.deviceLayer,
    authRequired: data.authRequired,
    nativePath: data.nativePath,
    nativeSource: data.nativeSource,
    sourceLayer: data.sourceLayer,
    sourceReason: data.sourceReason,
    sourceAlg: data.sourceAlg,
    mediaSource: data.mediaSource,
    mediaVerification: data.mediaVerification,
    mediaVerificationLimitations: data.mediaVerificationLimitations,
    responseDevice: data.responseDevice,
    requestKey: data.requestKey,
  });
}

function architectureGraph(events: Array<HyperbeamDebugEvent>, mode: HyperbeamMode) {
  const devices: Record<string, number> = {};
  const samples: Array<Record<string, any>> = [];
  const counters = {
    hyperbeamEvents: 0,
    authEvents: 0,
    fallbackEvents: 0,
    legacyEvents: 0,
    sdkEvents: 0,
    ssrEvents: 0,
    deviceEvents: 0,
    cacheEvents: 0,
    uploadEvents: 0,
    rangeEvents: 0,
    arweaveEvents: 0,
  };

  events.forEach((event) => {
    const data = event.data || {};
    const url = String(data.url || '');
    const eventDevices = devicesFromEventData(data);
    const device = eventDevices[0] || '';
    const path = String(data.devicePath || data.urlParts?.path || '');
    const sourceLayer = String(data.sourceLayer || '');
    const authEvent = Boolean(data.authRequired || sourceLayer.includes('auth'));
    const mediaRange = isMediaRangeEvent(data, path, device);

    if (
      !mediaRange &&
      mode !== HYPERBEAM_MODES.original &&
      (url.includes('127.0.0.1') || url.includes('localhost') || device)
    ) {
      counters.hyperbeamEvents += 1;
    }
    if (authEvent) counters.authEvents += 1;
    if (sourceLayer.startsWith('fallback')) counters.fallbackEvents += 1;
    if (sourceLayer === 'original' || isLegacyBackedEvent(data, eventDevices, mediaRange)) counters.legacyEvents += 1;
    if (path.includes('/$/api/') || authEvent) counters.ssrEvents += 1;
    if (path.includes('~cache@1.0')) counters.cacheEvents += 1;
    if (
      path.includes('/arweave') ||
      path.includes('~arweave') ||
      device.includes('arweave') ||
      sourceLayer.includes('arweave')
    ) {
      counters.arweaveEvents += 1;
    }
    if (
      path.includes('~odysee-upload@1.0') ||
      (path.includes('/hyperbeam-upload/') && !isHyperbeamUploadReadPath(path) && !isHyperbeamUploadMetadataPath(path))
    ) {
      counters.uploadEvents += 1;
    }
    if (mediaRange) counters.rangeEvents += 1;
    if (eventDevices.length) {
      counters.deviceEvents += eventDevices.length;
      eventDevices.forEach((observedDevice) => {
        devices[observedDevice] = Number(devices[observedDevice] || 0) + 1;
      });
    }
    if (event.label === 'request' && !path.includes('/public/') && samples.length < 12) {
      samples.push(
        pruneEmpty({
          method: data.method,
          path: compactPath(path || data.url),
          device,
          auth: data.authRequired || undefined,
          source: sourceLayer || undefined,
        })
      );
    }
  });
  counters.sdkEvents = Math.max(0, counters.hyperbeamEvents - counters.ssrEvents);

  return {
    ...counters,
    devices,
    deviceNames: Object.keys(devices).sort((a, b) => Number(devices[b] || 0) - Number(devices[a] || 0)),
    samples,
  };
}

function devicesFromEventData(data: Record<string, any>) {
  const devices = new Set<string>();
  [data.device, data.responseDevice].forEach((device) => {
    const value = normalizeGraphDevice(device);
    if (value && !MODELED_GRAPH_DEVICES.has(value)) devices.add(value);
  });
  [data.devicePath, data.nativePath, data.urlParts?.path].forEach((path) => {
    String(path || '')
      .match(/(^|\/)(~[^/?#]+)/g)
      ?.forEach((match) => {
        const device = match.replace(/^\//, '');
        if (device && !MODELED_GRAPH_DEVICES.has(device)) devices.add(device);
      });
  });
  return Array.from(devices);
}

function normalizeGraphDevice(device: any) {
  const value = String(device || '');
  if (!value) return '';
  return value.startsWith('~') ? value : `~${value}`;
}

function isLegacyBackedEvent(data: Record<string, any>, devices: Array<string>, mediaRange: boolean) {
  if (mediaRange) return false;
  if (data.authRequired) return false;
  const legacyDevices = devices.filter(isLegacyStoreBackedDevice);
  if (legacyDevices.length > 0) return true;
  return data.deviceLayer === 'compat-device' && String(data.sourceLayer || '') === 'original';
}

function isLegacyStoreBackedDevice(device: string) {
  return (
    device.startsWith('~odysee-') &&
    !device.includes('upload') &&
    !device.includes('account') &&
    !device.includes('file-reaction') &&
    !device.includes('comment')
  );
}

function isMediaRangeEvent(data: Record<string, any>, path: string, device: string) {
  const contentType = String(data.contentType || '').toLowerCase();
  return (
    Boolean(data.contentRange) ||
    contentType.startsWith('video/') ||
    contentType.startsWith('audio/') ||
    contentType === 'application/octet-stream' ||
    isHyperbeamUploadReadPath(path) ||
    path.includes('/media') ||
    path.includes('/playback') ||
    path.includes('~odysee-blob@1.0') ||
    device.includes('blob')
  );
}

function isHyperbeamUploadReadPath(path: string) {
  return path.includes('/$/api/hyperbeam-upload/v1/read/');
}

function isHyperbeamUploadMetadataPath(path: string) {
  return path.includes('/$/api/hyperbeam-upload/v1/list') || path.includes('/$/api/hyperbeam-upload/v1/index');
}

function formatDetail(value: any) {
  if (typeof value === 'string') return value;
  return JSON.stringify(value, null, 2);
}

const headerIconButtonStyle = {
  flex: '0 0 auto',
  height: 18,
  border: '1px solid rgba(255,255,255,0.28)',
  borderRadius: 4,
  padding: '0 6px',
  background: 'rgba(255,255,255,0.08)',
  color: '#f9fafb',
  cursor: 'pointer',
  font: 'inherit',
  fontSize: 10,
  lineHeight: 1,
} as const;

const sectionIconButtonStyle = {
  flex: '0 0 auto',
  marginLeft: 'auto',
  width: 24,
  height: 22,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  border: '1px solid rgba(255,255,255,0.22)',
  borderRadius: 4,
  padding: 0,
  background: 'rgba(255,255,255,0.07)',
  color: 'rgba(255,255,255,0.82)',
  cursor: 'pointer',
} as const;

function segmentPanelStyle(activeSegmentCount: number) {
  return {
    flex: `1 1 ${Math.max(320, Math.floor(100 / Math.max(1, activeSegmentCount)))}%`,
    minWidth: 0,
    minHeight: 0,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  } as const;
}

function SegmentToggle({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        border: `1px solid ${active ? 'rgba(14,165,233,0.68)' : 'rgba(255,255,255,0.18)'}`,
        borderRadius: 4,
        padding: '2px 8px',
        background: active ? 'rgba(14,165,233,0.2)' : 'rgba(255,255,255,0.045)',
        color: active ? '#e0f2fe' : 'rgba(255,255,255,0.42)',
        cursor: 'pointer',
        font: 'inherit',
      }}
    >
      {children}
    </button>
  );
}

function eventColor(event: HyperbeamDebugEvent) {
  if (isFailedEvent(event)) return hyperbeamDebugColor('error');
  if (event.data?.authRequired) return hyperbeamDebugColor(event.level, 'native-device:auth');
  if (event.label === 'request') return hyperbeamDebugColor('info');
  return hyperbeamDebugColor(event.level, event.data?.sourceLayer || nativeLayer(event) || event.data?.deviceLayer);
}

function mergeEvents(current: Array<HyperbeamDebugEvent>, incoming: Array<HyperbeamDebugEvent>) {
  let next = current;

  incoming.forEach((event) => {
    const key = eventKey(event);
    const existingIndex = next.findLastIndex((currentEvent) => eventKey(currentEvent) === key);
    if (existingIndex !== -1) {
      const existing = next[existingIndex];
      next = [...next];
      next[existingIndex] = {
        ...event,
        data: {
          ...event.data,
          repeatCount: Number(existing.data?.repeatCount || 1) + 1,
          firstSeen: existing.data?.firstSeen || existing.time,
          lastSeen: event.time,
        },
      };
      return;
    }

    next = [...next.slice(-(MAX_EVENTS - 1)), event];
  });

  return next;
}

function eventSummary(event: HyperbeamDebugEvent, mode: HyperbeamMode) {
  const data = event.data || {};
  const path =
    data.sourceLayer === 'browser-resource'
      ? data.urlParts?.path || data.devicePath || data.nativePath
      : data.nativePath || data.devicePath;
  const bits = uniqueSummaryBits([
    mode,
    data.authRequired ? '🔒' : undefined,
    data.repeatCount ? `x${data.repeatCount}` : undefined,
    data.method,
    data.status ? String(data.status) : undefined,
    data.authRequired ? 'native-device:auth' : data.deviceLayer,
    data.nativeSource,
    data.sourceLayer,
    data.sourceAlg,
    data.mediaVerification,
    data.elapsedMs !== undefined ? `${data.elapsedMs}ms` : undefined,
    path,
    data.requestKey,
  ]);
  return bits.length ? `- ${bits.join(' ')}` : '';
}

function uniqueSummaryBits(bits: Array<string | number | undefined | null | false>) {
  const seen = new Set<string>();
  return bits.filter((bit) => {
    if (!bit) return false;
    const value = String(bit);
    if (seen.has(value)) return false;
    seen.add(value);
    return true;
  }) as Array<string>;
}

function modeLabel(mode: HyperbeamMode) {
  switch (mode) {
    case HYPERBEAM_MODES.original:
      return 'Legacy wiring';
    case HYPERBEAM_MODES.hyperbeam:
      return 'HyperBEAM';
    default:
      return mode;
  }
}

function modeEndpointLabel(mode: HyperbeamMode) {
  if (mode === HYPERBEAM_MODES.original) return `${modeLabel(mode)} · normal Odysee/API calls`;
  return String(ODYSEE_HYPERBEAM_NODE_API).replace(/\/+$/, '');
}

function modeWaitLabel(mode: HyperbeamMode) {
  return mode === HYPERBEAM_MODES.original ? 'Legacy' : 'HyperBEAM';
}

function filterDisabledInMode(filter: FilterKey, mode: HyperbeamMode) {
  if (filter === 'all' || filter === 'other') return false;

  if (mode === HYPERBEAM_MODES.original) {
    return filter !== 'get' && filter !== 'failed' && filter !== 'original';
  }

  return false;
}

function emptyFilterCounts(): Record<FilterKey, number> {
  return FILTERS.reduce((counts, filter) => ({ ...counts, [filter.key]: 0 }), {} as Record<FilterKey, number>);
}

function countFilters(events: Array<HyperbeamDebugEvent>): Record<FilterKey, number> {
  return events.reduce((counts, event) => {
    FILTERS.forEach((filter) => {
      if (eventMatchesFilter(event, filter.key)) {
        counts[filter.key] = Number(counts[filter.key] || 0) + 1;
      }
    });
    return counts;
  }, emptyFilterCounts());
}

function eventMatchesFilter(event: HyperbeamDebugEvent, filter: FilterKey) {
  const data = event.data || {};
  const sourceLayer = String(data.sourceLayer || '');
  const deviceLayer = String(data.deviceLayer || '');
  const isNative = Boolean(data.nativePath || data.nativeSource || data.sourceAlg || nativeLayer(event));
  const isPlainRequest = event.label === 'request';

  switch (filter) {
    case 'all':
      return true;
    case 'other':
      return !CATEGORY_FILTER_KEYS.some((key) => eventMatchesFilter(event, key));
    case 'failed':
      return isFailedEvent(event);
    case 'get':
      return String(data.method || '').toUpperCase() === 'GET';
    case 'original':
      if (isPlainRequest) return false;
      return sourceLayer === 'original';
    case 'native-device':
      if (isPlainRequest) return false;
      return !data.authRequired && (deviceLayer === 'native-device' || isNative);
    case 'native-device:auth':
      if (isPlainRequest) return false;
      return Boolean(data.authRequired);
    case 'fallback':
      if (isPlainRequest) return false;
      return sourceLayer.startsWith('fallback') || sourceLayer === 'device:fallback';
    default:
      return false;
  }
}

function eventMatchesTraceFocus(event: HyperbeamDebugEvent, focus: TraceFocus) {
  const data = event.data || {};

  if (focus.kind === 'auth') {
    const devicePath = String(data.devicePath || data.nativePath || '');
    const requestKey = String(data.requestKey || '');
    const focusDevicePath = String(focus.devicePath || '');
    const focusRequestKey = String(focus.requestKey || '');
    const matchesDevice = Boolean(focusDevicePath && devicePath === focusDevicePath);
    const matchesRequest = Boolean(focusRequestKey && requestKey.includes(focusRequestKey));
    return matchesDevice || matchesRequest;
  }

  const haystack = eventClaimFocusText(event);
  return traceFocusNeedles(focus).some((needle) => haystack.includes(needle));
}

function eventMatchesTraceGraphFocus(event: HyperbeamDebugEvent, focus: TraceFocus) {
  const data = event.data || {};

  if (focus.kind === 'auth') return eventMatchesTraceFocus(event, focus);

  const routeText = traceGraphRouteText(data);
  const routeMatches = traceFocusNeedles(focus).some((needle) => routeText.includes(needle));
  if (!routeMatches) return false;

  return !isAggregateClaimRoute(data) && !isAuxiliaryClaimRoute(data);
}

function traceGraphRouteText(data: Record<string, any>) {
  return [
    data.devicePath,
    data.nativePath,
    data.urlParts?.path,
    data.urlParts?.search,
    data.url,
    data.requestKey,
    data.nativeSource,
  ]
    .filter(Boolean)
    .join('\n')
    .toLowerCase();
}

function isAggregateClaimRoute(data: Record<string, any>) {
  const path = String(data.devicePath || data.nativePath || data.urlParts?.path || data.url || '').toLowerCase();
  const requestKey = String(data.requestKey || '').toLowerCase();

  return path.includes('/search') || path.includes('/resolve') || requestKey.startsWith('search:');
}

function isAuxiliaryClaimRoute(data: Record<string, any>) {
  const path = String(data.devicePath || data.nativePath || data.urlParts?.path || data.url || '').toLowerCase();
  return (
    path.includes('/~odysee-comment@1.0/list') ||
    path.includes('/~odysee-file-reaction@1.0/list') ||
    path.includes('/~odysee-file@1.0/view-count')
  );
}

function isDebugTraceProbe(data: Record<string, any>) {
  const headers = data.requestHeaders || {};
  return String(headers['x-hyperbeam-debug-trace'] || headers['X-Hyperbeam-Debug-Trace'] || '') === 'claim-evidence';
}

function isNativeUploadTraceFocus(focus: TraceFocus | null) {
  if (!focus || focus.kind !== 'claim') return false;
  return [focus.target, focus.claimId, focus.txid]
    .filter(Boolean)
    .some((value) => !isLegacyClaimId(value) && !isLegacyOutpoint(value));
}

function isLegacyClaimId(value: any) {
  return /^[0-9a-f]{40}$/i.test(String(value || ''));
}

function isLegacyOutpoint(value: any) {
  return /^[0-9a-f]{64}:\d+$/i.test(String(value || ''));
}

function traceFocusNeedles(focus: TraceFocus) {
  return [
    focus.target,
    focus.claimId,
    focus.txid,
    focus.txid && focus.nout !== undefined ? `${focus.txid}:${focus.nout}` : undefined,
    focus.sdHash,
  ]
    .filter((needle): needle is string => Boolean(needle && needle.length >= 6))
    .map((needle) => needle.toLowerCase());
}

function eventFocusText(event: HyperbeamDebugEvent) {
  return JSON.stringify(sanitizeHyperbeamDebugValue(event)).toLowerCase();
}

function eventClaimFocusText(event: HyperbeamDebugEvent) {
  const data = event.data || {};
  return JSON.stringify(
    sanitizeHyperbeamDebugValue({
      label: event.label,
      method: data.method,
      url: data.url,
      urlParts: data.urlParts,
      device: data.device,
      devicePath: data.devicePath,
      nativePath: data.nativePath,
      nativeSource: data.nativeSource,
      mediaSource: data.mediaSource,
      requestKey: data.requestKey,
      claimKeys: data.claimKeys,
      requestBody: data.requestBody,
      body: data.body,
      responseBody: data.responseBody,
      response: data.response,
      result: data.result,
    })
  ).toLowerCase();
}

function normalizedFilterNeedles(value: string) {
  return value.trim().toLowerCase().split(/\s+/).filter(Boolean);
}

function eventMatchesObjectTextFilter(event: HyperbeamDebugEvent, needles: Array<string>) {
  const haystack = eventObjectFilterText(event);
  return needles.every((needle) => haystack.includes(needle));
}

function eventObjectFilterText(event: HyperbeamDebugEvent) {
  return [
    eventFocusText(event),
    event.data?.url,
    event.data?.devicePath,
    event.data?.nativePath,
    event.data?.requestKey,
  ]
    .filter(Boolean)
    .join('\n')
    .toLowerCase();
}

function isResponseLikeEvent(event: HyperbeamDebugEvent) {
  return event.label === 'response' || event.label.endsWith(' response');
}

function isFailedEvent(event: HyperbeamDebugEvent) {
  const data = event.data || {};
  const sourceLayer = String(data.sourceLayer || '');
  return (
    event.level === 'error' ||
    data.ok === false ||
    Number(data.status) >= 400 ||
    sourceLayer === 'native-missing' ||
    sourceLayer === 'native-failed'
  );
}

function eventKey(event: HyperbeamDebugEvent) {
  const data = event.data || {};
  const body = data.body || {};
  return JSON.stringify({
    callId: data.callId,
    label: event.label,
    level: event.level,
    method: data.method,
    status: data.status,
    ok: data.ok,
    pagePath: data.pagePath,
    nativePath: data.nativePath,
    nativeSource: data.nativeSource,
    sourceAlg: data.sourceAlg,
    requestKey: data.requestKey,
    devicePath: data.devicePath,
    device: data.device,
    deviceLayer: data.deviceLayer,
    sourceLayer: data.sourceLayer,
    sourceReason: data.sourceReason,
    reason: body.reason,
    kind: body.kind,
    key: body.key,
  });
}

function relevantEvents(events: Array<HyperbeamDebugEvent>, mode: HyperbeamMode) {
  const relevantIndexes = new Set<number>();

  events.forEach((event, index) => {
    if (isRelevant(event)) {
      relevantIndexes.add(index);
      const previous = events[index - 1];
      if (previous?.label === 'request') relevantIndexes.add(index - 1);
    }
  });

  return events
    .filter((_event, index) => relevantIndexes.has(index))
    .slice(-MAX_RELEVANT_EVENTS)
    .map((event) => compactEvent(event, mode));
}

function isRelevant(event: HyperbeamDebugEvent) {
  const data = event.data || {};
  const status = Number(data.status);
  const sourceLayer = String(data.sourceLayer || '');
  const deviceLayer = String(data.deviceLayer || '');
  const isNative = Boolean(data.nativePath || data.nativeSource || data.sourceAlg || nativeLayer(event));
  return (
    event.level === 'error' ||
    data.ok === false ||
    status >= 400 ||
    sourceLayer === 'native-device' ||
    deviceLayer === 'native-device' ||
    isNative ||
    sourceLayer.startsWith('fallback') ||
    sourceLayer === 'native-missing' ||
    sourceLayer === 'native-failed' ||
    sourceLayer === 'unknown' ||
    data.sourceReason === 'native_source_required'
  );
}

function compactEvent(event: HyperbeamDebugEvent, mode: HyperbeamMode) {
  const data = event.data || {};
  const body = data.body;
  return pruneEmpty({
    mode,
    time: event.time,
    firstSeen: data.firstSeen,
    lastSeen: data.lastSeen,
    repeatCount: data.repeatCount,
    label: event.label,
    level: event.level,
    method: data.method,
    status: data.status,
    ok: data.ok,
    device: data.device,
    deviceLayer: data.deviceLayer,
    nativePath: compactPath(data.nativePath),
    nativeSource: data.nativeSource,
    authRequired: data.authRequired,
    requestKey: compactPath(data.requestKey),
    sourceAlg: data.sourceAlg,
    sourceLayer: data.sourceLayer,
    sourceReason: data.sourceReason,
    elapsedMs: data.elapsedMs,
    devicePath: compactPath(data.devicePath),
    url: data.url ? limitString(sanitizeHyperbeamDebugUrl(String(data.url)), 360) : undefined,
    bodyBytes: data.bodyBytes,
    contentType: data.contentType,
    response: compactBody(body),
  });
}

function nativeLayer(event: HyperbeamDebugEvent) {
  const data = event.data || {};
  if (data.authRequired) return 'native-device:auth';
  if (data.nativePath || data.nativeSource || data.sourceAlg) return 'native-device';
  return undefined;
}

function compactBody(body: any) {
  body = sanitizeHyperbeamDebugValue(body);
  if (body === undefined || body === null) return undefined;
  if (typeof body !== 'object') return limitString(String(body), 1200);

  return pruneEmpty({
    status: body.status,
    reason: body.reason,
    kind: body.kind,
    key: compactKey(body.key),
    error: body.error,
    message: body.message,
    missing_record_path: body.missing_record_path,
    body: typeof body.body === 'string' ? limitString(body.body, 1200) : undefined,
    sourceLayer:
      body['source-layer'] ||
      body.source_layer ||
      body.sourceLayer ||
      body.result?.['source-layer'] ||
      body.result?.source_layer ||
      body.result?.sourceLayer,
    resultStatus: body.result?.status,
    resultReason: body.result?.reason,
    resultKind: body.result?.kind,
    resultKey: compactKey(body.result?.key),
  });
}

function compactPath(value: any) {
  const path = String(value || '');
  return limitString(
    path.replace(/([?&](?:params64|urls64|uri64|auth_token|token|signature)=)[^&\s]+/gi, '$1...'),
    260
  );
}

function compactKey(value: any) {
  value = sanitizeHyperbeamDebugValue(value);
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') return value;

  const parsed = parseJsonObject(value);
  if (parsed) {
    const claimIds = Array.isArray(parsed.claim_ids) ? parsed.claim_ids : undefined;
    const commentIds =
      typeof parsed.comment_ids === 'string' ? parsed.comment_ids.split(',').filter(Boolean) : undefined;
    return pruneEmpty({
      claim_ids_count: claimIds?.length,
      claim_ids_sample: claimIds?.slice(0, 5),
      comment_ids_count: commentIds?.length,
      comment_ids_sample: commentIds?.slice(0, 5),
      page: parsed.page,
      page_size: parsed.page_size,
      no_totals: parsed.no_totals,
      channel_id: parsed.channel_id,
      channel_name: parsed.channel_name,
      claim_id: parsed.claim_id,
      sort_by: parsed.sort_by,
      top_level: parsed.top_level,
    });
  }

  return limitString(value, 360);
}

function parseJsonObject(value: string) {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : undefined;
  } catch (_error) {
    return undefined;
  }
}

function pruneEmpty<T extends Record<string, any>>(value: T) {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined && item !== null && item !== '')
  );
}

function limitString(value: string, maxLength: number) {
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}
