export default function KpiIcon({ type }) {
  if (type === 'networth') {
    return (
      <svg className="kpiIcon" viewBox="0 0 24 24" aria-hidden="true">
        <rect x="3.5" y="6.5" width="17" height="11" rx="2.5" />
        <path d="M14 12h3.5" />
        <circle cx="16.5" cy="12" r="0.8" />
      </svg>
    );
  }

  if (type === 'ath') {
    return (
      <svg className="kpiIcon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 16l5-5 3 3 7-7" />
        <path d="M14 7h5v5" />
      </svg>
    );
  }

  if (type === 'atl') {
    return (
      <svg className="kpiIcon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 8l5 5 3-3 7 7" />
        <path d="M14 17h5v-5" />
      </svg>
    );
  }

  if (type === 'latest') {
    return (
      <svg className="kpiIcon" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="8" />
        <path d="M12 8v4l3 2" />
      </svg>
    );
  }

  if (type === 'period') {
    return (
      <svg className="kpiIcon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 18h16" />
        <path d="M7 15v-3" />
        <path d="M12 15V8" />
        <path d="M17 15v-5" />
      </svg>
    );
  }

  if (type === 'peak') {
    return (
      <svg className="kpiIcon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M3 18l6-8 4 5 3-4 5 7" />
      </svg>
    );
  }

  return (
    <svg className="kpiIcon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 9l6 6 4-4 8 8" />
      <path d="M3 18h18" />
    </svg>
  );
}
