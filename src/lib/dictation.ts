// Joins the pieces a speech recognizer returns into one sentence.
// Desktop Chrome sends each new stretch of speech as its own piece ("החלפת", " ציוד").
// Android Chrome sends the whole sentence so far, again and again ("החלפת", "החלפת ציוד",
// "החלפת ציוד קצה"), sometimes repeating a piece unchanged. Plain concatenation turns
// that into "החלפתהחלפת ציוד...", so a piece that repeats or extends the text so far replaces it.
export function joinTranscripts(pieces: string[]): string {
  let text = ''
  for (const raw of pieces) {
    const piece = raw.trim().replace(/\s+/g, ' ')
    if (!piece) continue
    if (!text || piece === text || piece.startsWith(`${text} `)) text = piece
    else if (text.endsWith(` ${piece}`)) continue
    else text = `${text} ${piece}`
  }
  return text
}
