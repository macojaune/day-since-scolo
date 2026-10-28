import Script from 'next/script'
import { useEffect, useState } from 'react'
import { ANALYTICS_HOST, ANALYTICS_SCRIPT, ANALYTICS_WEBSITE_ID, flushAnalyticsEvents, sanitizeAnalyticsPayload } from '~/utils/analytics'

export default function Analytics() {
  const [enabled, setEnabled] = useState(false)
  useEffect(() => {
    if (window.location.hostname !== ANALYTICS_HOST) return
    window.scoloBeforeAnalytics = sanitizeAnalyticsPayload
    setEnabled(true)
  }, [])
  if (!enabled) return null
  return <Script
    id="scolo-umami"
    src={ANALYTICS_SCRIPT}
    data-website-id={ANALYTICS_WEBSITE_ID}
    data-domains={ANALYTICS_HOST}
    data-exclude-search="true"
    data-exclude-hash="true"
    data-before-send="scoloBeforeAnalytics"
    onReady={flushAnalyticsEvents}
  />
}
