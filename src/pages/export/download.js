// Browser download helper: hand the user a file built in memory.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export function downloadText(filename, text, mime = 'text/plain;charset=utf-8') {
  const blob = new Blob([text], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/** Several files one after another (browsers throttle simultaneous downloads). */
export async function downloadAll(files = [], mime) {
  for (let i = 0; i < files.length; i++) {
    downloadText(files[i].filename, files[i].text, mime)
    if (i < files.length - 1) await sleep(600)
  }
}

export const KML_MIME = 'application/vnd.google-earth.kml+xml'
export const CSV_MIME = 'text/csv;charset=utf-8'
