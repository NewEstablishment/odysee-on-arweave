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
import ClaimTrace, { type TraceFocus } from './claimTrace';

const MAX_EVENTS = 1200;
const MAX_RELEVANT_EVENTS = 24;
const MAX_EVENTS_PER_FRAME = 80;
const ODYSEE_COLOR = '#e91e63';
const MEDIA_COLOR = '#14b8a6';
const SEARCH_COLOR = '#f97316';
const SEARCH_INDEX_NODE = 'search-index:hyperbeam_messages';
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
const MODELED_GRAPH_DEVICES = new Set(['~cache@1.0']);
const GRAPH_NATIVE_DEVICES = new Set<string>(['~search@1.0', '~query@1.0']);
const GRAPH_PRODUCT_DEVICE_ROWS = [
  '~odysee-comment@1.0',
  '~odysee-claim@1.0',
  '~odysee-account@1.0',
  '~odysee-stream@1.0',
  '~odysee-upload@1.0',
] as const;
const GRAPH_NATIVE_DEVICE_ROWS = ['~query@1.0', '~search@1.0'] as const;
const GRAPH_DEVICE_ROWS = [...GRAPH_PRODUCT_DEVICE_ROWS, ...GRAPH_NATIVE_DEVICE_ROWS] as const;
const GRAPH_STORE_ROWS = ['cache@1.0', 'hb_store_odysee', 'hb_store_lbry_blob'] as const;
const GRAPH_LEGACY_ROWS = ['Odysee API', 'Chainquery', 'Blobcache'] as const;
const ARCH_NODE_MIN_W = 150;
const ARCH_NODE_MAX_W = 220;
const ARCH_SMALL_NODE_H = 52;
const ARCH_MEDIUM_NODE_H = 64;
const ARCH_LARGE_NODE_H = 74;
type ArchitectureRect = { x: number; y: number; w: number; h: number };
type ArchitectureRects = Record<string, ArchitectureRect>;
type ArchitecturePoint = { x: number; y: number };
type ArchitecturePairCounts = Record<string, Record<string, number>>;
type ArchitectureColumnWidths = {
  left: number;
  middle: number;
  device: number;
  store: number;
  backend: number;
};
const ARCHITECTURE_ARROW_MARKERS = [
  { id: 'hb-arrow-blue', color: '#38bdf8' },
  { id: 'hb-arrow-hyperbeam', color: '#0ea5e9' },
  { id: 'hb-arrow-auth', color: '#22c55e' },
  { id: 'hb-arrow-cache', color: '#facc15' },
  { id: 'hb-arrow-legacy', color: ODYSEE_COLOR },
  { id: 'hb-arrow-search', color: SEARCH_COLOR },
  { id: 'hb-arrow-muted', color: '#64748b' },
  { id: 'hb-arrow-media', color: MEDIA_COLOR },
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
        node: String(ODYSEE_HYPERBEAM_NODE_API).replace(/\/+$/, ''),
        generatedAt: new Date().toISOString(),
        events: relevantEvents(events),
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
        height: maximized ? '100vh' : open ? '58vh' : undefined,
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
              {String(ODYSEE_HYPERBEAM_NODE_API).replace(/\/+$/, '')}
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
                      const focusedCount = focusedFilterCounts[filter.key] || 0;
                      const globalCount = filterCounts[filter.key] || 0;
                      const traceActive = Boolean(activeTrace && focusedCount > 0);
                      return (
                        <button
                          key={filter.key}
                          type="button"
                          onClick={() => toggleFilter(filter.key)}
                          title={active ? `Remove ${filter.label} filter` : `Filter ${filter.label}`}
                          style={{
                            border: `1px solid ${active || traceActive ? filter.color : 'rgba(255,255,255,0.22)'}`,
                            borderRadius: 4,
                            padding: '1px 6px',
                            background: active
                              ? 'rgba(255,255,255,0.12)'
                              : traceActive
                                ? traceFilterBackground(filter.color)
                                : 'rgba(255,255,255,0.05)',
                            color: filter.color,
                            cursor: 'pointer',
                            font: 'inherit',
                            fontWeight: traceActive ? 700 : 400,
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
                      <div style={{ color: 'rgba(255,255,255,0.62)' }}>waiting for HyperBEAM calls</div>
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
                            {event.label} {eventSummary(event)}
                          </button>
                          {isExpanded && <RequestDetail event={event} eventIndex={index} events={events} />}
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
}: {
  event: HyperbeamDebugEvent;
  eventIndex: number;
  events: Array<HyperbeamDebugEvent>;
}) {
  const data = mergedRequestDetailData(event, eventIndex, events);
  const responsePeer = findRequestLifecyclePeer(event, eventIndex, events);
  const responseMissingText =
    event.label === 'request' && !responsePeer ? 'no matching response event captured yet' : undefined;
  const route = routeSummary(data);
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

function Metric({ label, value, color }: { label: string; value: any; color?: string }) {
  return (
    <div
      style={{
        minWidth: 0,
        padding: '5px 6px',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 4,
        background: 'rgba(0,0,0,0.14)',
      }}
    >
      <div style={{ color: 'rgba(255,255,255,0.44)', fontSize: 10, marginBottom: 2 }}>{label}</div>
      <div
        style={{
          color: color || 'rgba(255,255,255,0.82)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {formatDetail(value)}
      </div>
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
  activeSegmentCount,
  activeTrace,
  selectedEvent,
  selectedEventIndex,
  maximized,
  onToggleMaximize,
}: {
  events: Array<HyperbeamDebugEvent>;
  activeSegmentCount: number;
  activeTrace: TraceFocus | null;
  selectedEvent: HyperbeamDebugEvent | null;
  selectedEventIndex: number | null;
  maximized: boolean;
  onToggleMaximize: () => void;
}) {
  const [zoom, setZoom] = React.useState(1);
  const graphEvents = events.filter((event) => !isDebugTraceProbe(event.data || {}));
  const graph = architectureGraph(graphEvents);
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
  const latestTraceMediaEventIndex = activeTraceGraphEvents.reduce((latest, event) => {
    const index = events.indexOf(event);
    return isMediaRangeGraphEvent(event) && index > latest ? index : latest;
  }, -1);
  const selectedShouldYieldToMedia =
    selectedEvent && activeTrace && latestTraceMediaEventIndex >= 0 && !isMediaRangeGraphEvent(selectedEvent);
  const latestTraceMediaEvents = selectedShouldYieldToMedia
    ? lifecycleEventsForSelection(events[latestTraceMediaEventIndex], latestTraceMediaEventIndex, events)
    : [];
  const graphFocusEvents = selectedShouldYieldToMedia
    ? latestTraceMediaEvents
    : selectedGraphEvents.length
      ? selectedGraphEvents
      : activeTraceGraphEvents;
  const displayGraph = selectedShouldYieldToMedia
    ? architectureGraph(activeTraceGraphEvents)
    : selectedGraphEvents.length
      ? architectureGraph(selectedGraphEvents)
      : activeTrace
        ? architectureGraph(activeTraceGraphEvents)
        : graph;
  const selectedRoute = selectedEvent
    ? routeSummary(mergedRequestDetailData(selectedEvent, selectedEventIndex || 0, events))
    : null;
  const isAuthTraceFocus = Boolean(!selectedEvent && activeTrace?.kind === 'auth');
  const hasSsr = displayGraph.ssrEvents > 0;
  const hasClaimRead =
    !isAuthTraceFocus &&
    (displayGraph.deviceEvents > 0 ||
      displayGraph.cacheEvents > 0 ||
      displayGraph.legacyEvents > 0 ||
      displayGraph.rangeEvents > 0);
  const showClaimPath = hasClaimRead;
  const showAuthPath = displayGraph.authEvents > 0;
  const showSearchIndexPath = displayGraph.searchIndexEvents > 0;
  const showLegacyPath = showClaimPath && displayGraph.legacyEvents > 0;
  const showMediaPath = showClaimPath && displayGraph.rangeEvents > 0;
  const deviceRows: Array<string> = [
    ...GRAPH_PRODUCT_DEVICE_ROWS,
    ...displayGraph.deviceNames.filter((device) => !GRAPH_DEVICE_ROWS.includes(device as any)),
    ...GRAPH_NATIVE_DEVICE_ROWS,
  ];
  const activeSearchDevices = Object.keys(displayGraph.searchIndexDevices).filter(
    (device) => Number(displayGraph.searchIndexDevices[device] || 0) > 0
  );
  const visibleStoreRows = GRAPH_STORE_ROWS.map(
    (store) => [store, Number(displayGraph.storeBackends[store] || 0)] as [string, number]
  ).concat(Object.entries(displayGraph.storeBackends).filter(([store]) => !GRAPH_STORE_ROWS.includes(store as any)));
  const legacyRows = GRAPH_LEGACY_ROWS.map(
    (backend) => [backend, Number(displayGraph.legacyBackends[backend] || 0)] as [string, number]
  ).concat(
    Object.entries(displayGraph.legacyBackends).filter(([backend]) => !GRAPH_LEGACY_ROWS.includes(backend as any))
  );
  const visibleLegacyRows = legacyRows;
  const columnWidths = architectureColumnWidths(deviceRows, visibleStoreRows, visibleLegacyRows);
  const layout = architectureLayout(maximized, columnWidths);
  const architectureRects = architectureNodeRects(
    layout,
    columnWidths,
    deviceRows,
    visibleStoreRows,
    visibleLegacyRows
  );
  const activeTraceNativeUpload = isNativeUploadTraceFocus(activeTrace);
  const selectedPath = selectedShouldYieldToMedia
    ? architectureSelectedPath(graphFocusEvents, deviceRows, latestTraceMediaEventIndex, events, architectureRects)
    : selectedGraphEvents.length
      ? architectureSelectedPath(selectedGraphEvents, deviceRows, selectedEventIndex, events, architectureRects)
      : activeTraceGraphEvents.length
        ? architectureSelectedPath(activeTraceGraphEvents, deviceRows, null, events, architectureRects)
        : activeTraceNativeUpload
          ? architectureTracePath(displayGraph, deviceRows, activeTrace, architectureRects)
          : null;
  const graphHeight = architectureGraphHeight(architectureRects);
  const hasGraphFocus = Boolean(selectedEvent || activeTrace);
  const showStaticBackendEdges = !selectedPath;
  const nodeActive = (node: string, fallback: boolean) => (selectedPath ? selectedPath.nodes.has(node) : fallback);
  const nodeFaded = (node: string, fallback: boolean) => (selectedPath ? !selectedPath.nodes.has(node) : fallback);
  const deviceActive = (device: string, count: number) =>
    selectedPath ? selectedPath.nodes.has(`device:${device}`) : count > 0;
  const deviceFaded = (device: string, count: number) =>
    selectedPath ? !selectedPath.nodes.has(`device:${device}`) : count === 0;
  const rowActive = (node: string, count: number) => (selectedPath ? selectedPath.nodes.has(node) : count > 0);
  const rowFaded = (node: string, count: number) => (selectedPath ? !selectedPath.nodes.has(node) : count === 0);
  const activeStorePairs = graphPairEntries(displayGraph.deviceStoreBackends);
  const activeDeviceLegacyPairs = graphPairEntries(displayGraph.deviceLegacyBackends);
  const activeDeviceDelegations = graphPairEntries(displayGraph.deviceDelegations);
  const activeLegacyPairs = graphPairEntries(displayGraph.storeLegacyBackends);

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
          gridTemplateRows: 'auto minmax(0, 1fr)',
          flex: '1 1 auto',
          gap: 8,
          minWidth: 0,
          width: '100%',
          minHeight: 0,
          overflow: 'auto',
          padding: '8px 9px 9px',
          boxSizing: 'border-box',
        }}
      >
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: 10,
            color: 'rgba(255,255,255,0.68)',
            overflowWrap: 'anywhere',
          }}
        >
          <span>
            devices observed: <span style={{ color: '#0ea5e9' }}>{displayGraph.deviceNames.length}</span>
          </span>
          <span style={{ flex: '0 0 18px' }} />
          {selectedEvent && (
            <span style={{ color: '#0ea5e9' }}>
              highlighting {selectedEvent.label} {selectedRoute?.devicePath || selectedRoute?.nativePath || ''}
            </span>
          )}
          {!selectedEvent && activeTrace && <span style={{ color: '#0ea5e9' }}>highlighting {activeTrace.label}</span>}
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              color: 'rgba(255,255,255,0.68)',
              userSelect: 'none',
              minWidth: 240,
              flex: '1 1 280px',
              marginLeft: 44,
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
        </div>
        <div
          style={{
            position: 'relative',
            minWidth: 0,
            minHeight: 0,
            overflow: 'auto',
          }}
        >
          <svg
            data-architecture-graph
            viewBox={`0 0 ${layout.viewWidth} ${graphHeight}`}
            preserveAspectRatio="xMidYMid meet"
            style={{
              width: `${zoom * 100}%`,
              height: `${zoom * 100}%`,
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
              {...architectureRects.ui}
              title="Browser UI"
              detail="Odysee React app"
              color="#e879f9"
              active={nodeActive('ui', hasGraphFocus)}
            />
            <ArchitectureNode
              {...architectureRects.sdk}
              title="SDK facade"
              detail="lbry.ts / hyperbeam.ts"
              color="#38bdf8"
              active={nodeActive('sdk', showClaimPath)}
              faded={nodeFaded('sdk', !showClaimPath)}
            />
            <ArchitectureNode
              {...architectureRects.ssr}
              title="SSR proxy"
              detail="/$/api routes"
              color="#38bdf8"
              active={nodeActive('ssr', showAuthPath || hasSsr)}
              faded={nodeFaded('ssr', !showAuthPath && !hasSsr)}
            />
            <ArchitectureNode
              {...architectureRects.hyperbeam}
              title="HyperBEAM"
              detail="router / runtime"
              color="#0ea5e9"
              active={nodeActive('hyperbeam', hasGraphFocus && displayGraph.hyperbeamEvents > 0)}
              faded={nodeFaded('hyperbeam', !displayGraph.hyperbeamEvents)}
            />
            {deviceRows.map((device, index) => (
              <ArchitectureNode
                key={device}
                {...architectureRects[`device:${device}`]}
                title={device}
                detail={displayGraph.devices[device] ? `${displayGraph.devices[device]} calls` : 'not observed yet'}
                color="#0ea5e9"
                active={deviceActive(device, Number(displayGraph.devices[device] || 0))}
                faded={deviceFaded(device, Number(displayGraph.devices[device] || 0))}
              />
            ))}
            <ArchitectureNode
              {...architectureRects.auth}
              title="Auth hook"
              detail="cookie/token -> signer"
              color="#22c55e"
              active={nodeActive('auth', showAuthPath)}
              faded={nodeFaded('auth', !showAuthPath)}
            />
            {visibleStoreRows.map(([store, count], index) => (
              <ArchitectureNode
                key={`store-${store}`}
                {...architectureRects[`store:${store}`]}
                title={store}
                detail={`${count} calls`}
                color="#facc15"
                active={rowActive(`store:${store}`, count)}
                faded={rowFaded(`store:${store}`, count)}
              />
            ))}
            <ArchitectureNode
              {...architectureRects[SEARCH_INDEX_NODE]}
              title="Search index"
              detail="hyperbeam_messages"
              color={SEARCH_COLOR}
              active={nodeActive(SEARCH_INDEX_NODE, showSearchIndexPath)}
              faded={nodeFaded(SEARCH_INDEX_NODE, !showSearchIndexPath)}
            />
            {visibleLegacyRows.map(([backend, count], index) => (
              <ArchitectureNode
                key={`legacy-${backend}`}
                {...architectureRects[`legacy:${backend}`]}
                title={backend}
                detail={`${count} calls`}
                color={ODYSEE_COLOR}
                active={rowActive(`legacy:${backend}`, count)}
                faded={rowFaded(`legacy:${backend}`, count)}
              />
            ))}
            <ArchitectureNode
              {...architectureRects.media}
              title="Media store"
              detail="chunks/range bytes"
              color={MEDIA_COLOR}
              active={nodeActive('media', showMediaPath)}
              faded={nodeFaded('media', !showClaimPath)}
            />
            {(!hasGraphFocus || displayGraph.sdkEvents > 0) && (
              <ArchitectureNodeEdge
                rects={architectureRects}
                from="ui"
                to="sdk"
                active={displayGraph.sdkEvents > 0}
                faded={displayGraph.sdkEvents === 0}
              />
            )}
            <ArchitectureNodeEdge
              rects={architectureRects}
              from="ui"
              to="ssr"
              active={showAuthPath || hasSsr}
              faded={!showAuthPath && !hasSsr}
              color="#0ea5e9"
            />
            {(!hasGraphFocus || (displayGraph.deviceEvents > 0 && !isAuthTraceFocus)) && (
              <ArchitectureNodeEdge
                rects={architectureRects}
                from="sdk"
                to="hyperbeam"
                active={displayGraph.deviceEvents > 0}
                faded={displayGraph.deviceEvents === 0}
              />
            )}
            {!selectedPath &&
              deviceRows.map((device, index) => (
                <ArchitectureNodeEdge
                  key={`${device}-edge`}
                  rects={architectureRects}
                  from="hyperbeam"
                  to={`device:${device}`}
                  active={Boolean(displayGraph.directDevices[device])}
                  faded={!displayGraph.directDevices[device]}
                />
              ))}
            {!selectedPath &&
              activeDeviceDelegations.map(([from, to]) => (
                <ArchitectureNodeEdge
                  key={`device-delegation-${from}-${to}`}
                  rects={architectureRects}
                  from={`device:${from}`}
                  to={`device:${to}`}
                  active
                  color="#0ea5e9"
                />
              ))}
            {!selectedPath &&
              activeStorePairs.map(([device, store]) => (
                <ArchitectureNodeEdge
                  key={`store-input-${device}-${store}`}
                  rects={architectureRects}
                  from={`device:${device}`}
                  to={`store:${store}`}
                  active
                  color="#facc15"
                />
              ))}
            {!selectedPath &&
              activeDeviceLegacyPairs.map(([device, backend]) => (
                <ArchitectureNodeEdge
                  key={`legacy-input-${device}-${backend}`}
                  rects={architectureRects}
                  from={`device:${device}`}
                  to={`legacy:${backend}`}
                  active
                  color={ODYSEE_COLOR}
                />
              ))}
            {showStaticBackendEdges && showSearchIndexPath && (
              <>
                {activeSearchDevices.map((device) => (
                  <ArchitectureNodeEdge
                    key={`search-index-${device}`}
                    rects={architectureRects}
                    from={`device:${device}`}
                    to={SEARCH_INDEX_NODE}
                    active
                    color={SEARCH_COLOR}
                  />
                ))}
              </>
            )}
            {(!hasGraphFocus || showAuthPath) && (
              <>
                <ArchitectureNodeEdge
                  rects={architectureRects}
                  from="ssr"
                  to="auth"
                  active={showAuthPath}
                  faded={!showAuthPath}
                  color="#22c55e"
                />
              </>
            )}
            {showStaticBackendEdges && activeStorePairs.some(([, store]) => store === 'cache@1.0') && (
              <ArchitectureNodeEdge
                rects={architectureRects}
                from="store:cache@1.0"
                to="store:hb_store_odysee"
                active={showClaimPath}
                faded={!showClaimPath}
                color="#facc15"
              />
            )}
            {showStaticBackendEdges &&
              activeLegacyPairs.map(([store, backend]) => (
                <ArchitectureNodeEdge
                  key={`legacy-store-${store}-${backend}`}
                  rects={architectureRects}
                  from={`store:${store}`}
                  to={`legacy:${backend}`}
                  active
                  color={ODYSEE_COLOR}
                />
              ))}
            {showStaticBackendEdges && (!hasGraphFocus || showMediaPath) && (
              <ArchitectureNodeEdge
                rects={architectureRects}
                from="store:hb_store_lbry_blob"
                to="media"
                active={showMediaPath}
                faded={!showClaimPath}
                color={MEDIA_COLOR}
              />
            )}
            {selectedPath?.flows.map((flow, index) => (
              <ArchitectureSelectedFlow key={`${flow.label}-${index}`} {...flow} />
            ))}
          </svg>
        </div>
      </div>
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
  const compact = h < 62;
  const titleY = y + (compact ? 21 : 25);
  const detailStartY = y + (compact ? 38 : 46);

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
        strokeWidth={active ? 2 : 1}
      />
      <text x={x + 8} y={titleY} fill="#f9fafb" fontSize="14" fontWeight="700">
        {limitString(title, Math.max(8, Math.floor((w - 16) / 8.1)))}
      </text>
      {(details || [detail || '']).map((line, index) => (
        <text
          key={`${line}-${index}`}
          x={x + 8}
          y={detailStartY + index * 15}
          fill="rgba(255,255,255,0.68)"
          fontSize="11"
        >
          {limitString(line, Math.max(12, Math.floor((w - 16) / 6)))}
        </text>
      ))}
    </g>
  );
}

function architectureDeviceY(index: number, deviceRows: Array<string>) {
  const nativeGroupStart = deviceRows.findIndex((device) => GRAPH_NATIVE_DEVICES.has(device));
  const groupGap = nativeGroupStart >= 0 && index >= nativeGroupStart ? 12 : 0;
  return 24 + index * 66 + groupGap;
}

function storeRowY(index: number) {
  return 176 + index * 64;
}

function legacyRowY(index: number) {
  return 154 + index * 62;
}

function architectureTextWidth(text: string) {
  return Math.ceil(text.length * 8.8 + 26);
}

function architectureColumnWidth(labels: Array<string>, min = ARCH_NODE_MIN_W, max = ARCH_NODE_MAX_W) {
  return Math.max(min, Math.min(max, ...labels.map(architectureTextWidth)));
}

function architectureColumnWidths(
  deviceRows: Array<string>,
  storeRows: Array<[string, number]>,
  legacyRows: Array<[string, number]>
): ArchitectureColumnWidths {
  return {
    left: architectureColumnWidth(['Browser UI', 'SDK facade', 'SSR proxy'], 112, 180),
    middle: architectureColumnWidth(['HyperBEAM', 'Auth hook'], 118, 170),
    device: architectureColumnWidth(deviceRows, 190, 280),
    store: architectureColumnWidth(
      ['Search index', ...storeRows.map(([store]) => store)],
      132,
      250
    ),
    backend: architectureColumnWidth(['Media store', ...legacyRows.map(([backend]) => backend)], 132, 220),
  };
}

function architectureNodeRects(
  layout: ReturnType<typeof architectureLayout>,
  widths: ArchitectureColumnWidths,
  deviceRows: Array<string>,
  storeRows: Array<[string, number]>,
  legacyRows: Array<[string, number]>
): ArchitectureRects {
  const rects: ArchitectureRects = {
    ui: { x: layout.uiX, y: 220, w: widths.left, h: ARCH_LARGE_NODE_H },
    sdk: { x: layout.sdkX, y: 106, w: widths.left, h: ARCH_LARGE_NODE_H },
    ssr: { x: layout.ssrX, y: 330, w: widths.left, h: ARCH_LARGE_NODE_H },
    hyperbeam: { x: layout.hyperbeamX, y: 220, w: widths.middle, h: ARCH_LARGE_NODE_H },
    auth: { x: layout.authX, y: 376, w: widths.middle, h: ARCH_LARGE_NODE_H },
    [SEARCH_INDEX_NODE]: { x: layout.storeX, y: layout.searchY, w: widths.store, h: 64 },
    media: { x: layout.mediaX, y: layout.mediaStoreY, w: widths.backend, h: ARCH_LARGE_NODE_H },
  };

  deviceRows.forEach((device, index) => {
    rects[`device:${device}`] = {
      x: layout.deviceX,
      y: architectureDeviceY(index, deviceRows),
      w: widths.device,
      h: ARCH_MEDIUM_NODE_H,
    };
  });
  storeRows.forEach(([store], index) => {
    rects[`store:${store}`] = { x: layout.storeX, y: storeRowY(index), w: widths.store, h: ARCH_SMALL_NODE_H };
  });
  legacyRows.forEach(([backend], index) => {
    rects[`legacy:${backend}`] = { x: layout.legacyX, y: legacyRowY(index), w: widths.backend, h: ARCH_SMALL_NODE_H };
  });

  return rects;
}

function architectureGraphHeight(rects: ArchitectureRects) {
  return Math.max(...Object.values(rects).map((rect) => rect.y + rect.h)) + 24;
}

function architectureRectCenter(rect: ArchitectureRect): ArchitecturePoint {
  return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
}

function architectureNodeAnchor(from: ArchitectureRect, to: ArchitectureRect): ArchitecturePoint {
  const fromCenter = architectureRectCenter(from);
  const toCenter = architectureRectCenter(to);
  const dx = toCenter.x - fromCenter.x;
  if (Math.abs(dx) > 1) return { x: dx >= 0 ? from.x + from.w : from.x, y: fromCenter.y };
  return { x: fromCenter.x, y: toCenter.y >= fromCenter.y ? from.y + from.h : from.y };
}

function architectureNodeEdgePoints(
  rects: ArchitectureRects,
  fromKey: string,
  toKey: string,
  via: Array<ArchitecturePoint> = []
) {
  const from = rects[fromKey];
  const to = rects[toKey];
  if (!from || !to) return '';

  const startTarget = via[0] ? { ...via[0], w: 0, h: 0 } : to;
  const endSource = via[via.length - 1] ? { ...via[via.length - 1], w: 0, h: 0 } : from;
  const start = architectureNodeAnchor(from, startTarget);
  const end = architectureNodeAnchor(to, endSource);
  return [start, ...via, end].map((point) => `${Math.round(point.x)},${Math.round(point.y)}`).join(' ');
}

function architectureConnect(
  rects: ArchitectureRects,
  fromKey: string,
  toKey: string,
  via: Array<ArchitecturePoint> = []
) {
  return architectureNodeEdgePoints(rects, fromKey, toKey, via);
}

function architectureLayout(maximized: boolean, widths: ArchitectureColumnWidths) {
  const gap = maximized ? 88 : 56;
  const uiX = 30;
  const sdkX = uiX + widths.left + gap;
  const hyperbeamX = sdkX + widths.left + gap;
  const deviceX = hyperbeamX + widths.middle + gap;
  const storeX = deviceX + widths.device + gap;
  const legacyX = storeX + widths.store + gap;
  const mediaX = legacyX;
  const viewWidth = mediaX + widths.backend + 40;

  return {
    viewWidth,
    uiX,
    sdkX,
    ssrX: sdkX,
    hyperbeamX,
    deviceX,
    authX: hyperbeamX,
    storeX,
    legacyX,
    mediaX,
    searchY: 390,
    uploadY: 460,
    mediaStoreY: 70,
  };
}

function architectureTracePath(
  graph: ReturnType<typeof architectureGraph>,
  deviceRows: Array<string>,
  activeTrace: TraceFocus | null,
  rects: ArchitectureRects
) {
  const nodes = new Set<string>(['ui']);
  const flows: Array<{ color: string; label: string; points: string }> = [];
  const isAuth = activeTrace?.kind === 'auth' || graph.authEvents > 0;
  const isNativeUpload = isNativeUploadTraceFocus(activeTrace);
  const hasDevice = deviceRows.length > 0 && deviceRows[0] !== 'No device calls yet';
  const device = hasDevice ? deviceRows[0] : '';
  const addFlow = (from: string, to: string, color: string, label: string) => {
    const points = architectureConnect(rects, from, to);
    if (points) flows.push({ color, label, points });
  };

  if (isAuth) {
    nodes.add('ssr');
    nodes.add('auth');
    if (device) nodes.add(`device:${device}`);
    addFlow('ui', 'ssr', '#22c55e', 'auth request');
    addFlow('ssr', 'auth', '#22c55e', 'auth request');
    if (device) addFlow('auth', `device:${device}`, '#22c55e', 'auth request');
    return { flows, nodes };
  }

  if (isNativeUpload) {
    nodes.add('ssr');
    nodes.add('store:hb_store_odysee');
    addFlow('ui', 'ssr', '#0ea5e9', 'request');
    addFlow('ssr', 'store:hb_store_odysee', '#facc15', 'store metadata');
  }

  if (!isNativeUpload || device) nodes.add('sdk');
  if (graph.hyperbeamEvents > 0) nodes.add('hyperbeam');
  if (device) nodes.add(`device:${device}`);

  if (!isNativeUpload || device) {
    addFlow('ui', 'sdk', '#0ea5e9', 'request');
    addFlow('sdk', 'hyperbeam', '#0ea5e9', 'request');
    if (device) addFlow('hyperbeam', `device:${device}`, '#0ea5e9', 'request');
  }

  if (graph.legacyEvents > 0 || graph.fallbackEvents > 0) {
    nodes.add('store:hb_store_odysee');
    nodes.add('legacy:Odysee API');
    addFlow(device ? `device:${device}` : 'hyperbeam', 'store:hb_store_odysee', '#facc15', 'store');
    addFlow('store:hb_store_odysee', 'legacy:Odysee API', ODYSEE_COLOR, 'legacy store');
  }

  if (graph.rangeEvents > 0) {
    nodes.add('ssr');
    nodes.add('store:hb_store_lbry_blob');
    nodes.add('media');
    addFlow('ui', 'ssr', '#0ea5e9', 'request');
    addFlow('ssr', 'store:hb_store_lbry_blob', MEDIA_COLOR, 'media bytes');
    addFlow('store:hb_store_lbry_blob', 'media', MEDIA_COLOR, 'media bytes');
  }

  if (graph.legacyEvents === 0 && graph.fallbackEvents === 0 && graph.rangeEvents === 0 && graph.cacheEvents > 0) {
    nodes.add('store:cache@1.0');
    addFlow(device ? `device:${device}` : 'hyperbeam', 'store:cache@1.0', '#facc15', 'cache');
  }

  return { flows, nodes };
}

function architectureSelectedPath(
  selectedEvents: Array<HyperbeamDebugEvent>,
  deviceRows: Array<string>,
  selectedEventIndex: number | null,
  allEvents: Array<HyperbeamDebugEvent>,
  rects: ArchitectureRects
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
  const selectedEventData = selectedEvents.map((event) => event.data || {});
  const selectedDevices = devicesFromEventData(selectedData);
  const selectedDevice = selectedDevices[0] || String(selectedData.device || selectedData.responseDevice || '');
  const selectedDeviceNode = selectedDevice ? `device:${selectedDevice}` : '';
  const genericSearchDevice =
    genericSearchBackendDevice(selectedData) ||
    selectedEventData.map(genericSearchBackendDevice).find((device) => Boolean(device)) ||
    '';
  const genericSearchDeviceNode = genericSearchDevice ? `device:${genericSearchDevice}` : '';
  const path = String(selectedData.devicePath || selectedData.nativePath || selectedData.urlParts?.path || '');
  const sourceLayer = String(selectedData.sourceLayer || '');
  const deviceLayer = String(selectedData.deviceLayer || '');
  const nativeSource = String(selectedData.nativeSource || '');
  const isUploadRead = isHyperbeamUploadReadPath(path);
  const isUploadMetadata = isHyperbeamUploadMetadataPath(path) || nativeSource === 'upload-index';
  const isStoreMetadata =
    isUploadMetadata || nativeSource === 'store' || deviceLayer === 'store' || isDirectImmutableStorePath(path);
  const isAuth = !isUploadRead && Boolean(selectedData.authRequired || sourceLayer.includes('auth'));
  const isSsr = path.includes('/$/api/');
  const frontend = isSsr || isAuth ? 'ssr' : 'sdk';
  const mediaRange = isMediaRangeEvent(selectedData, path, selectedDevice);
  const isSearch = isSearchGraphDevice(selectedDevice) || isSearchGraphPath(path);
  const hasRequest = selectedEvents.some((event) => event.label === 'request' || event.label === 'request failed');
  const hasResponse = selectedEvents.some(isResponseLikeEvent);
  const hasLifecycle = hasRequest || hasResponse;
  const isCache = path.includes('~cache@1.0') || nativeSource === 'cache';
  const isLegacy =
    !isSearch &&
    !mediaRange &&
    (selectedData.deviceLayer === 'compat-device' || sourceLayer === 'original' || sourceLayer.startsWith('fallback'));
  const selectedFailed = selectedEvents.some(isFailedEvent);
  const legacyBackend = legacyBackendName(selectedData, selectedDevices, mediaRange) || (isLegacy ? 'Odysee API' : '');
  const backendFlows: Array<{ color: string; label: string; node: string; source?: string; viaStore?: boolean }> = [];
  const sourceNode = selectedDeviceNode || (isAuth ? 'auth' : !isUploadRead ? 'hyperbeam' : frontend);
  const addFlow = (from: string, to: string, color: string, label: string, via?: Array<ArchitecturePoint>) => {
    const points = architectureConnect(rects, from, to, via);
    if (points) flows.push({ color, label, points });
  };

  nodes.add(frontend);
  if (!isUploadRead) nodes.add('hyperbeam');
  if (isAuth) nodes.add('auth');
  if (selectedDeviceNode) nodes.add(selectedDeviceNode);

  const addBackendFlow = (flow: {
    color: string;
    label: string;
    node: string;
    source?: string;
    viaStore?: boolean;
  }) => {
    if (
      !backendFlows.some(
        (existing) => existing.node === flow.node && existing.label === flow.label && existing.source === flow.source
      )
    ) {
      backendFlows.push(flow);
    }
  };

  selectedEventData.forEach((data) => {
    const eventDevices = devicesFromEventData(data);
    const eventDevice = eventDevices[0] || String(data.device || data.responseDevice || '');
    const eventPath = String(data.devicePath || data.nativePath || data.urlParts?.path || '');
    const eventMediaRange = isMediaRangeEvent(data, eventPath, eventDevice);
    const eventStoreBackend = storeBackendName(data, eventPath, eventDevice, eventMediaRange);
    const eventLegacyBackend = legacyBackendName(data, eventDevices, eventMediaRange);
    const eventSearch = isSearchGraphDevice(eventDevice) || isSearchGraphPath(eventPath);

    if (eventMediaRange) {
      addBackendFlow({ color: MEDIA_COLOR, label: 'media bytes', node: 'media', viaStore: true });
    }
    if (eventStoreBackend) {
      addBackendFlow({ color: '#facc15', label: eventStoreBackend, node: `store:${eventStoreBackend}` });
    }
    if (eventLegacyBackend && !eventSearch) {
      addBackendFlow({ color: ODYSEE_COLOR, label: eventLegacyBackend, node: `legacy:${eventLegacyBackend}` });
    }
    const eventGenericSearchDevice = genericSearchBackendDevice(data);
    if (eventGenericSearchDevice) {
      addBackendFlow({
        color: SEARCH_COLOR,
        label: 'search index',
        node: SEARCH_INDEX_NODE,
        source: `device:${eventGenericSearchDevice}`,
      });
    }
  });

  if (isCache) {
    addBackendFlow({ color: '#facc15', label: 'cache', node: 'store:cache@1.0' });
  }
  if (genericSearchDeviceNode) {
    addBackendFlow({
      color: SEARCH_COLOR,
      label: 'search index',
      node: SEARCH_INDEX_NODE,
      source: genericSearchDeviceNode,
    });
  }
  if (mediaRange) {
    addBackendFlow({
      color: MEDIA_COLOR,
      label: 'media bytes',
      node: 'media',
      viaStore: true,
    });
  }
  if (isLegacy && legacyBackend) {
    addBackendFlow({
      color: ODYSEE_COLOR,
      label: legacyBackend,
      node: `legacy:${legacyBackend}`,
      viaStore: true,
    });
  }
  if (isStoreMetadata) {
    addBackendFlow({ color: '#facc15', label: 'store metadata', node: 'store:hb_store_odysee' });
  }
  backendFlows.forEach((backend) => nodes.add(backend.node));
  if (backendFlows.some((backend) => backend.viaStore)) nodes.add('store:hb_store_odysee');

  if (hasRequest) {
    const requestColor = selectedFailed && !hasResponse ? '#ff4d7d' : isAuth ? '#22c55e' : '#0ea5e9';
    const requestLabel = selectedFailed && !hasResponse ? 'failed request' : isAuth ? 'auth request' : 'request';
    addFlow('ui', frontend, requestColor, requestLabel);
    if (isAuth) {
      addFlow(frontend, 'auth', requestColor, requestLabel);
      if (selectedDeviceNode) addFlow('auth', selectedDeviceNode, requestColor, requestLabel);
    } else if (!isUploadRead) {
      addFlow(frontend, 'hyperbeam', requestColor, requestLabel);
      if (selectedDeviceNode) addFlow('hyperbeam', selectedDeviceNode, requestColor, requestLabel);
    }
  }

  backendFlows.forEach((backend) => {
    if (!hasLifecycle) return;
    const backendSource = backend.source || sourceNode;
    if (backend.viaStore) {
      addFlow(backendSource, 'store:hb_store_odysee', backend.color, backend.label);
      addFlow('store:hb_store_odysee', backend.node, backend.color, backend.label);
    } else {
      addFlow(backendSource, backend.node, backend.color, backend.label);
    }
  });

  if (hasResponse) {
    const responseColor = selectedFailed ? '#ff4d7d' : '#22c55e';
    const responseLabel = selectedFailed ? 'failed response' : 'response';
    backendFlows.forEach((backend) => {
      const backendSource = backend.source || sourceNode;
      if (backend.viaStore) {
        addFlow(backend.node, 'store:hb_store_odysee', responseColor, responseLabel);
        addFlow('store:hb_store_odysee', backendSource, responseColor, responseLabel);
      } else {
        addFlow(backend.node, backendSource, responseColor, responseLabel);
      }
    });
    if (selectedDeviceNode && !isAuth && !isUploadRead) {
      addFlow(selectedDeviceNode, 'hyperbeam', responseColor, responseLabel);
    }
    if (isAuth && selectedDeviceNode) addFlow(selectedDeviceNode, 'auth', responseColor, responseLabel);
    if (isAuth) addFlow('auth', 'ssr', responseColor, responseLabel);
    else if (!isUploadRead) addFlow('hyperbeam', frontend, responseColor, responseLabel);
    addFlow(frontend, 'ui', responseColor, responseLabel);
  }

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

function ArchitectureSelectedFlow({ color, points }: { color: string; label: string; points: string }) {
  return (
    <g>
      <polyline
        points={points}
        fill="none"
        opacity={0.96}
        stroke={color}
        strokeWidth={3}
        markerEnd={architectureArrowMarker(color)}
      />
    </g>
  );
}

function ArchitectureNodeEdge({
  active,
  color = '#38bdf8',
  faded,
  from,
  rects,
  to,
  via,
}: {
  active?: boolean;
  color?: string;
  faded?: boolean;
  from: string;
  rects: ArchitectureRects;
  to: string;
  via?: Array<ArchitecturePoint>;
}) {
  const points = architectureNodeEdgePoints(rects, from, to, via);
  if (!points) return null;

  return <ArchitectureFlow active={active} color={color} faded={faded} points={points} />;
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
    case ODYSEE_COLOR:
      return 'url(#hb-arrow-legacy)';
    case SEARCH_COLOR:
      return 'url(#hb-arrow-search)';
    case '#64748b':
      return 'url(#hb-arrow-muted)';
    case MEDIA_COLOR:
      return 'url(#hb-arrow-media)';
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
    case ODYSEE_COLOR:
    case '#64748b':
      return 'rgba(148,163,184,0.14)';
    case SEARCH_COLOR:
      return 'rgba(249,115,22,0.15)';
    case MEDIA_COLOR:
      return 'rgba(20,184,166,0.14)';
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
    case ODYSEE_COLOR:
    case '#64748b':
      return 'rgba(71,85,105,0.94)';
    case SEARCH_COLOR:
      return 'rgba(234,88,12,0.9)';
    case MEDIA_COLOR:
      return 'rgba(190,18,60,0.9)';
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
    case ODYSEE_COLOR:
      return 'rgba(148,163,184,0.16)';
    case '#ff4d7d':
      return 'rgba(255,77,125,0.16)';
    default:
      return 'rgba(14,165,233,0.16)';
  }
}

function routeSummary(data: any) {
  return pruneEmpty({
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
    claimKeys: data.claimKeys,
  });
}

function architectureGraph(events: Array<HyperbeamDebugEvent>) {
  const devices: Record<string, number> = {};
  const directDevices: Record<string, number> = {};
  const searchIndexDevices: Record<string, number> = {};
  const storeBackends: Record<string, number> = {};
  const legacyBackends: Record<string, number> = {};
  const deviceDelegations: ArchitecturePairCounts = {};
  const deviceStoreBackends: ArchitecturePairCounts = {};
  const deviceLegacyBackends: ArchitecturePairCounts = {};
  const storeLegacyBackends: ArchitecturePairCounts = {};
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
    searchEvents: 0,
    searchIndexEvents: 0,
    uploadEvents: 0,
    rangeEvents: 0,
  };

  events.forEach((event) => {
    const data = event.data || {};
    const url = String(data.url || '');
    const eventDevices = devicesFromEventData(data);
    const device = eventDevices[0] || '';
    const path = String(data.devicePath || data.urlParts?.path || '');
    const sourceLayer = String(data.sourceLayer || '');
    const deviceLayer = String(data.deviceLayer || '');
    const nativeSource = String(data.nativeSource || '');
    const authEvent = Boolean(data.authRequired || sourceLayer.includes('auth'));
    const mediaRange = isMediaRangeEvent(data, path, device);
    const storeBackend = storeBackendName(data, path, device, mediaRange);
    const legacyBackend = legacyBackendName(data, eventDevices, mediaRange);

    if (!mediaRange && (url.includes('127.0.0.1') || url.includes('localhost') || device)) {
      counters.hyperbeamEvents += 1;
    }
    if (authEvent) counters.authEvents += 1;
    if (sourceLayer.startsWith('fallback')) counters.fallbackEvents += 1;
    if (sourceLayer === 'original' || isLegacyBackedEvent(data, eventDevices, mediaRange)) counters.legacyEvents += 1;
    if (path.includes('/$/api/') || authEvent) counters.ssrEvents += 1;
    if (
      path.includes('~cache@1.0') ||
      storeBackend === 'cache@1.0' ||
      deviceLayer === 'store' ||
      nativeSource === 'store' ||
      isDirectImmutableStorePath(path)
    ) {
      counters.cacheEvents += 1;
    }
    if (isSearchGraphDevice(device) || isSearchGraphPath(path)) {
      counters.searchEvents += 1;
    }
    const genericSearchDevice = genericSearchBackendDevice(data);
    if (genericSearchDevice) {
      counters.searchIndexEvents += 1;
      searchIndexDevices[genericSearchDevice] = Number(searchIndexDevices[genericSearchDevice] || 0) + 1;
    }
    if (
      path.includes('~odysee-upload@1.0') ||
      (path.includes('/hyperbeam-upload/') && !isHyperbeamUploadReadPath(path))
    ) {
      counters.uploadEvents += 1;
    }
    if (mediaRange) counters.rangeEvents += 1;
    if (storeBackend) storeBackends[storeBackend] = Number(storeBackends[storeBackend] || 0) + 1;
    if (legacyBackend) legacyBackends[legacyBackend] = Number(legacyBackends[legacyBackend] || 0) + 1;
    if (device && storeBackend) incrementGraphPair(deviceStoreBackends, device, storeBackend);
    if (device && legacyBackend && !storeBackend) incrementGraphPair(deviceLegacyBackends, device, legacyBackend);
    if (storeBackend && legacyBackend) incrementGraphPair(storeLegacyBackends, storeBackend, legacyBackend);
    if (eventDevices.length) {
      counters.deviceEvents += eventDevices.length;
      eventDevices.forEach((observedDevice) => {
        devices[observedDevice] = Number(devices[observedDevice] || 0) + 1;
        directDevices[observedDevice] = Number(directDevices[observedDevice] || 0) + 1;
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
    directDevices,
    searchIndexDevices,
    storeBackends,
    legacyBackends,
    deviceDelegations,
    deviceStoreBackends,
    deviceLegacyBackends,
    storeLegacyBackends,
    deviceNames: Object.keys(devices).sort((a, b) => Number(devices[b] || 0) - Number(devices[a] || 0)),
    samples,
  };
}

function incrementGraphPair(pairs: ArchitecturePairCounts, from: string, to: string) {
  pairs[from] = pairs[from] || {};
  pairs[from][to] = Number(pairs[from][to] || 0) + 1;
}

function graphPairEntries(pairs: ArchitecturePairCounts) {
  return Object.entries(pairs).flatMap(([from, targets]) =>
    Object.entries(targets)
      .filter(([, count]) => count > 0)
      .map(([to]) => [from, to] as [string, string])
  );
}

function storeBackendName(data: Record<string, any>, path: string, device: string, mediaRange: boolean) {
  const sourceLayer = String(data.sourceLayer || '');
  const deviceLayer = String(data.deviceLayer || '');
  const nativeSource = String(data.nativeSource || '');

  if (mediaRange) return 'hb_store_lbry_blob';
  if (device === '~query@1.0' || path.includes('/~query@1.0/')) return 'cache@1.0';
  if (path.includes('~cache@1.0') || nativeSource === 'cache') return 'cache@1.0';
  if (path.includes('~arweave') || device.includes('arweave') || sourceLayer.includes('arweave')) return '';
  if (nativeSource === 'upload-index' || path.includes('/hyperbeam-upload/v1/list')) return '';
  if (nativeSource === 'store' || deviceLayer === 'store' || isDirectImmutableStorePath(path)) return 'hb_store_odysee';
  if (sourceLayer === 'original' || sourceLayer.startsWith('fallback')) return '';
  return '';
}

function legacyBackendName(data: Record<string, any>, devices: Array<string>, mediaRange: boolean) {
  if (mediaRange) return '';
  const path = String(data.devicePath || data.nativePath || data.urlParts?.path || data.url || '').toLowerCase();
  const deviceText = devices.join(' ').toLowerCase();
  const sourceLayer = String(data.sourceLayer || '');

  if (path.includes('~odysee-account@1.0') || deviceText.includes('odysee-account')) return 'Odysee API';
  if (path.includes('~odysee-file') || path.includes('~odysee-blob') || deviceText.includes('file')) return 'Blobcache';
  if (path.includes('~lbry') || path.includes('claim-output') || deviceText.includes('lbry')) return 'Chainquery';
  if (sourceLayer === 'original' || sourceLayer.startsWith('fallback') || devices.some(isLegacyStoreBackedDevice)) {
    return 'Odysee API';
  }
  return '';
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
  if (isSearchDeviceEventData(data)) return false;
  const legacyDevices = devices.filter(isLegacyStoreBackedDevice);
  if (legacyDevices.length > 0) return true;
  return data.deviceLayer === 'compat-device' && String(data.sourceLayer || '') === 'original';
}

function isLegacyStoreBackedDevice(device: string) {
  return device.startsWith('~odysee-') && !device.includes('upload') && !device.includes('search');
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

function isMediaRangeGraphEvent(event: HyperbeamDebugEvent) {
  const data = event.data || {};
  const path = String(data.devicePath || data.nativePath || data.urlParts?.path || '');
  const device = devicesFromEventData(data)[0] || String(data.device || data.responseDevice || '');
  return isMediaRangeEvent(data, path, device);
}

function isHyperbeamUploadReadPath(path: string) {
  return path.includes('/$/api/hyperbeam-upload/v1/read/');
}

function isHyperbeamUploadMetadataPath(path: string) {
  return path.includes('/$/api/hyperbeam-upload/v1/list') || path.includes('/$/api/hyperbeam-upload/v1/index');
}

function isDirectImmutableStorePath(path: string) {
  const id = String(path || '')
    .replace(/^\/+/, '')
    .split(/[/?#]/)[0];
  return /^[0-9A-Za-z_-]{43}$/.test(id);
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

function eventSummary(event: HyperbeamDebugEvent) {
  const data = event.data || {};
  const path =
    data.sourceLayer === 'browser-resource'
      ? data.urlParts?.path || data.devicePath || data.nativePath
      : data.nativePath || data.devicePath;
  const bits = uniqueSummaryBits([
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
    data.claimKeys ? `claims:${data.claimKeys}` : undefined,
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

  if (focus.kind === 'search') {
    return isSearchDeviceEventData(data);
  }

  const haystack = eventClaimFocusText(event);
  return traceFocusNeedles(focus).some((needle) => haystack.includes(needle));
}

function eventMatchesTraceGraphFocus(event: HyperbeamDebugEvent, focus: TraceFocus) {
  const data = event.data || {};

  if (focus.kind === 'auth' || focus.kind === 'search') return eventMatchesTraceFocus(event, focus);

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

function isSearchDeviceEventData(data: Record<string, any>) {
  const device = normalizeGraphDevice(data.device);
  const responseDevice = normalizeGraphDevice(data.responseDevice);
  const path = String(data.devicePath || data.nativePath || data.urlParts?.path || data.url || '');
  return isSearchGraphDevice(device) || isSearchGraphDevice(responseDevice) || isSearchGraphPath(path);
}

function isSearchGraphDevice(device: string) {
  return device === '~search@1.0';
}

function isSearchGraphPath(path: string) {
  return path.includes('/~search@1.0/');
}

function genericSearchBackendDevice(data: Record<string, any>) {
  const directDevice = normalizeGraphDevice(data.device || data.responseDevice);
  const path = String(data.devicePath || data.nativePath || data.urlParts?.path || data.url || '');
  if (directDevice === '~search@1.0' || path.includes('/~search@1.0/')) return '~search@1.0';
  return '';
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

function relevantEvents(events: Array<HyperbeamDebugEvent>) {
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
    .map(compactEvent);
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

function compactEvent(event: HyperbeamDebugEvent) {
  const data = event.data || {};
  const body = data.body;
  return pruneEmpty({
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
