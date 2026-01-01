import { useEffect, useState } from "react";
import { BigPlayButton, ControlBar, LoadingSpinner, Player, PlayToggle } from "video-react";
import "video-react/dist/video-react.css";

export function VideoPlayer({ src, onPlayerChange = () => {}, onChange = () => {}, startTime = 0 }) {
  const [player, setPlayer] = useState(undefined);
  const [playerState, setPlayerState] = useState(undefined);

  useEffect(() => {
    if (playerState) {
      onChange(playerState);
    }
  }, [playerState]);

  useEffect(() => {
    onPlayerChange(player);
    if (player) {
      player.subscribeToStateChange(setPlayerState);
    }
  }, [player]);

  return (
    <div className="video-player" style={{ width: "400px", height: "auto" }}>
      <Player ref={(player) => setPlayer(player)} startTime={startTime}>
        <source src={src} />
        <BigPlayButton position="center" />
        <LoadingSpinner />
        <ControlBar autoHide={false} disableDefaultControls={true}>
          <PlayToggle />
        </ControlBar>
      </Player>
    </div>
  );
}