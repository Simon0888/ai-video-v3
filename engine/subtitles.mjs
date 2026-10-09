export function validateCorrections(raw, edits, duration) {
  if (!Array.isArray(edits) || edits.length !== raw.segments.length) throw Error('字幕段数与原始转写不一致');
  return raw.segments.map((segment, i) => {
    const edit = edits[i];
    if (edit?.id !== segment.id || typeof edit.text !== 'string' || edit.text.length > 1000) throw Error('无效的字幕校正');
    if (!(segment.start >= 0 && segment.end > segment.start && segment.end <= duration + 0.2)) throw Error('字幕时间超出视频范围');
    return { ...segment, text: edit.text.trim(), corrected: edit.text.trim() !== segment.text,
      // ASR word positions refer to the original wording; do not claim realignment after an edit.
      words: edit.text.trim() === segment.text ? segment.words : [] };
  });
}

function stamp(seconds) {
  const millis = Math.max(0, Math.round(seconds * 1000));
  return `${String(Math.floor(millis / 3600000)).padStart(2,'0')}:${String(Math.floor(millis / 60000) % 60).padStart(2,'0')}:${String(Math.floor(millis / 1000) % 60).padStart(2,'0')},${String(millis % 1000).padStart(3,'0')}`;
}

export function toSrt(segments) {
  return segments.filter(s => s.text.trim()).map((s, i) => `${i + 1}\n${stamp(s.start)} --> ${stamp(s.end)}\n${s.text.replace(/\r/g,'').replace(/\n{2,}/g,'\n')}\n`).join('\n');
}

function assTime(seconds) {
  const n = Math.max(0, Math.round(seconds * 100));
  return `${Math.floor(n / 360000)}:${String(Math.floor(n / 6000) % 60).padStart(2,'0')}:${String(Math.floor(n / 100) % 60).padStart(2,'0')}.${String(n % 100).padStart(2,'0')}`;
}

export function toAss(segments, width, height) {
  const fontSize = Math.max(20, Math.round(Math.min(width / 18, height / 26)));
  const margin = Math.max(20, Math.round(width * 0.07));
  const bottom = Math.max(20, Math.round(height * 0.035));
  const safeText = text => {
    // Escape ASS markup before adding our own line breaks. User text cannot supply overrides.
    const clean = String(text).replace(/[{}\\]/g, '').replace(/[\r\n]+/g, ' ');
    const chunks = []; let line = '';
    for (const char of clean) { line += char; if ([...line].length >= 20) { chunks.push(line); line = ''; } }
    if (line) chunks.push(line);
    return chunks.join('\\N');
  };
  return `[Script Info]\nScriptType: v4.00+\nPlayResX: ${width}\nPlayResY: ${height}\nWrapStyle: 0\nScaledBorderAndShadow: yes\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,Microsoft YaHei,${fontSize},&H00FFFFFF,&H00FFFFFF,&H00141414,&H80000000,0,0,0,0,100,100,0,0,3,2,0,2,${margin},${margin},${bottom},1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n` + segments.filter(s => s.text.trim()).map(s => `Dialogue: 0,${assTime(s.start)},${assTime(s.end)},Default,,0,0,0,,${safeText(s.text)}\n`).join('');
}
