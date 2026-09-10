/**
 * IP 人物动画：从 GLB clips 里挑原地待机，给 runtime 的 AnimationMixer 播。
 * 没有骨骼/片段时播不了，不能靠代码捏走路。
 */

function clipDuration(clip) {
  const n = Number(clip && clip.duration)
  return isFinite(n) && n > 0 ? n : 0
}

function clipName(clip) {
  return String((clip && clip.name) || '').toLowerCase()
}

function scoreIpClip(clip, index) {
  const name = clipName(clip)
  let score = 0
  if (/idle|stand|breath|breathe|rest|loop|wait|ambient/.test(name)) score += 8
  if (/wave|hello|greet|talk|speak|chat|look/.test(name)) score += 5
  if (/walk|run|jump|die|death|attack|sit/.test(name)) score -= 5
  if (clipDuration(clip) > 0) score += 1
  if (index === 0) score += 0.2
  return score
}

function pickIpIdleClip(clips) {
  const list = Array.isArray(clips) ? clips : []
  let best = null
  let bestScore = -1e9
  for (let i = 0; i < list.length; i++) {
    const clip = list[i]
    if (!clip) continue
    const tracks = clip.tracks
    if (clipDuration(clip) <= 0 && !(tracks && tracks.length)) continue
    const score = scoreIpClip(clip, i)
    if (!best || score > bestScore) {
      best = clip
      bestScore = score
    }
  }
  return best
}

module.exports = {
  pickIpIdleClip,
  scoreIpClip
}
