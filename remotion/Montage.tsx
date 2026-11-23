import type { CSSProperties } from "react";
import { AbsoluteFill, Audio, Img, OffthreadVideo, Sequence, useCurrentFrame } from "remotion";
import {
  clipKind,
  movementAt,
  musicGainAt,
  spanFrames,
  speechSpans,
  splitCues,
  textAppearanceAt,
  textTop,
  toFrame,
  transitionAt,
  dbToGain,
  type AudioClip,
  type SubtitleCue,
  type TextClip,
  type Timeline,
  type VideoClip,
} from "./logic";

// Composition « Montage » : la timeline de l'agent 7 (Video.timelineJson) telle quelle en inputProps.
// Mêmes rendus dans le worker (MP4 1080×1920) et dans le Remotion Player du panneau.

const FONT = '"Archivo", "Arial Black", "Helvetica Neue", Arial, sans-serif';
const HIGHLIGHT = "#FFD60A";
const OUTLINE = "0 0 12px rgba(0,0,0,0.85), 0 4px 0 rgba(0,0,0,0.9)";

export function Montage(timeline: Timeline) {
  const { video, texte, sous_titres: cues, audio } = timeline.pistes;
  return (
    <AbsoluteFill style={{ backgroundColor: "#000", fontFamily: FONT }}>
      {video.map((clip, index) => (
        <Sequence key={`v-${index}`} {...spanFrames(clip)} name={clip.plan}>
          <ClipLayer clip={clip} />
        </Sequence>
      ))}
      {texte.map((text, index) => (
        <Sequence key={`t-${index}`} {...spanFrames(text)} name={`Texte ${index + 1}`}>
          <TextLayer text={text} />
        </Sequence>
      ))}
      <Subtitles cues={cues} />
      <AudioTracks clips={audio} cues={cues} />
    </AbsoluteFill>
  );
}

function ClipLayer({ clip }: { clip: VideoClip }) {
  const frame = useCurrentFrame();
  const { durationInFrames } = spanFrames(clip);
  const move = movementAt(clip.mouvement, frame, durationInFrames);
  const enter = transitionAt(clip.transition_entree, frame);
  const style: CSSProperties = {
    width: "100%",
    height: "100%",
    objectFit: "cover",
    transform: `translate(${move.x + enter.x}%, ${move.y + enter.y}%) scale(${move.scale * enter.scale})`,
    opacity: enter.opacity,
  };
  const kind = clipKind(clip);
  if (kind === "video") return <OffthreadVideo src={clip.src} muted style={style} />;
  if (kind === "image") return <Img src={clip.src} style={style} />;
  return <AbsoluteFill style={{ ...style, background: kind === "missing" ? "#3A3B3D" : "radial-gradient(circle at 50% 40%, #2A2B2E 0%, #000 70%)" }} />;
}

function TextLayer({ text }: { text: TextClip }) {
  const frame = useCurrentFrame();
  const look = textAppearanceAt(text.animation, frame, spanFrames(text).durationInFrames);
  return (
    <AbsoluteFill>
      <p
        style={{
          position: "absolute",
          top: textTop(text.position),
          left: "8%",
          right: "14%",
          margin: 0,
          textAlign: "center",
          color: "#fff",
          fontSize: 92,
          fontWeight: 900,
          lineHeight: 1.05,
          textShadow: OUTLINE,
          opacity: look.opacity,
          transform: `translate(${look.x}%, ${look.y}%) scale(${look.scale})`,
        }}
      >
        {text.texte}
      </p>
    </AbsoluteFill>
  );
}

/** Sous-titres recalés en code : un groupe de 1 à 4 mots, le mot prononcé en jaune, dans la zone sûre. */
function Subtitles({ cues }: { cues: readonly SubtitleCue[] }) {
  const parts = splitCues(cues);
  return (
    <>
      {cues.map((cue, index) => {
        const part = parts[index];
        if (!part) return null;
        return (
          <Sequence key={`s-${index}`} {...spanFrames(cue)} name={`Sous-titre ${index + 1}`} layout="none">
            <p
              style={{
                position: "absolute",
                bottom: "23%",
                left: "8%",
                right: "14%",
                margin: 0,
                textAlign: "center",
                color: "#fff",
                fontSize: 76,
                fontWeight: 900,
                lineHeight: 1.1,
                textShadow: OUTLINE,
              }}
            >
              {part.before}
              <span style={{ color: HIGHLIGHT }}>{part.active}</span>
              {part.after}
            </p>
          </Sequence>
        );
      })}
    </>
  );
}

function AudioTracks({ clips, cues }: { clips: readonly AudioClip[]; cues: readonly SubtitleCue[] }) {
  const spans = speechSpans(cues);
  return (
    <>
      {clips
        .filter((clip) => clip.src !== "")
        .map((clip, index) => (
          <Sequence key={`a-${index}`} from={toFrame(clip.debut_s)} layout="none" name={`${clip.type} ${index + 1}`}>
            <Audio
              src={clip.src}
              volume={clip.type === "musique" ? (frame) => musicGainAt(frame + toFrame(clip.debut_s), clip, spans) : dbToGain(clip.volume_db)}
            />
          </Sequence>
        ))}
    </>
  );
}
