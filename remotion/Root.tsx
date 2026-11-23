import { Composition, type CalculateMetadataFunction } from "remotion";
import { COMPOSITION_ID, durationInFrames, FPS, HEIGHT, WIDTH, type Timeline } from "./logic";
import { Montage } from "./Montage";

// Racine du bundle Remotion (rendu du worker). La durée vient de la timeline reçue en inputProps.

const calculateMetadata: CalculateMetadataFunction<Timeline> = ({ props }) => ({ durationInFrames: durationInFrames(props) });

/** Timeline vide : seulement pour ouvrir la composition sans inputProps. */
export const EMPTY_TIMELINE: Timeline = {
  idee_id: "exemple",
  duree_totale_s: 1,
  export: { largeur: WIDTH, hauteur: HEIGHT, fps: FPS, codec: "h264", audio: "aac_48k" },
  pistes: { video: [], texte: [], sous_titres: [], audio: [] },
  alertes: [],
};

export function RemotionRoot() {
  return (
    <Composition
      id={COMPOSITION_ID}
      component={Montage}
      width={WIDTH}
      height={HEIGHT}
      fps={FPS}
      durationInFrames={FPS}
      defaultProps={EMPTY_TIMELINE}
      calculateMetadata={calculateMetadata}
    />
  );
}
