import { useEffect, useId, useState } from 'react'
import { GAME_SHARE_URL, shareLinks, shareMessage, type ShareBoard } from '~/game/sandale/sharing'
import styles from './SandaleLeaderboard.module.css'

export default function LeaderboardShare({ board }: { board?: ShareBoard }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [image, setImage] = useState<{ file: File; url: string; canShare: boolean } | null>(null)
  const optionsId = useId()
  const links = shareLinks(board)
  useEffect(() => () => { if (image) URL.revokeObjectURL(image.url) }, [image])

  async function copyMessage() {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('clipboard')
      await navigator.clipboard.writeText(links.copy)
      setMessage('Message copié.')
    } catch { setMessage('La copie est indisponible. Utilise X ou WhatsApp.') }
  }

  async function story() {
    setBusy(true)
    setMessage(null)
    setImage(null)
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), 20000)
    try {
      const response = await fetch('/api/sandale-story', { signal: controller.signal, cache: 'no-store' })
      if (!response.ok || !response.headers.get('content-type')?.startsWith('image/png')) throw new Error('image')
      const file = new File([await response.blob()], 'bet-a-milpat-classement-story.png', { type: 'image/png' })
      if (!file.size) throw new Error('empty image')
      const url = URL.createObjectURL(file)
      let canShare = false
      try { canShare = typeof navigator.share === 'function' && typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] }) } catch { /* Download remains available if native sharing fails. */ }
      setImage({ file, url, canShare })
      const link = document.createElement('a')
      link.href = url
      link.download = file.name
      document.body.append(link)
      link.click()
      link.remove()
      setMessage('Image prête. Si le téléchargement ne démarre pas, utilise le lien ci-dessous.')
    } catch {
      setMessage(controller.signal.aborted ? 'La création prend trop de temps. Réessaie.' : 'L’image n’a pas pu être créée. Réessaie.')
    } finally { window.clearTimeout(timeout); setBusy(false) }
  }

  async function shareImage() {
    if (!image || typeof navigator.share !== 'function') return
    setMessage('Si aucun menu de partage ne s’ouvre, utilise « Télécharger l’image ».')
    try { await navigator.share({ files: [image.file], title: 'BÈT a milpat', text: `${shareMessage(board)}\n${GAME_SHARE_URL}` }) }
    catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) setMessage('Le partage n’a pas abouti. Tu peux télécharger l’image.')
    }
  }

  return <section className={styles.share} aria-label="Partager le classement">
    <button type="button" className={styles.shareButton} aria-expanded={open} aria-controls={optionsId} onClick={() => setOpen(value => !value)}>
      Partager le classement
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 15V3m-4 4 4-4 4 4M5 12v8h14v-8" /></svg>
    </button>
    {open && <div id={optionsId} className={styles.shareOptions}>
      <a href={links.x} target="_blank" rel="noopener noreferrer">X / Twitter</a>
      <a href={links.whatsapp} target="_blank" rel="noopener noreferrer">WhatsApp</a>
      <button type="button" disabled={busy} onClick={() => void story()}>{busy ? 'Création…' : 'Story 9:16'}</button>
      <button type="button" onClick={() => void copyMessage()}>Copier le message</button>
    </div>}
    {message && <p className={styles.shareStatus} role="status">{message}</p>}
    {image && <div className={styles.shareOptions}>
      <a href={image.url} download={image.file.name}>Télécharger l’image</a>
      {image.canShare && <button type="button" onClick={() => void shareImage()}>Partager l’image</button>}
    </div>}
  </section>
}
