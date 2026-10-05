// Real browser MediaStreams from synthetic sources, not physical devices or vendor requests.
module.exports = async function installDeviceFixture(page) {
  await page.addInitScript(() => {
    const active = new Set();
    navigator.mediaDevices.getUserMedia = async constraints => {
      const stream = new MediaStream();
      if (constraints.video) {
        const canvas = document.createElement("canvas"); canvas.width = 320; canvas.height = 240;
        const ctx = canvas.getContext("2d"); let tick = 0;
        const draw = () => {
          ctx.fillStyle = "#174b52"; ctx.fillRect(0, 0, 320, 240);
          ctx.fillStyle = "#eac5dc"; ctx.fillRect(50 + tick++ % 40, 50, 120, 100);
          ctx.fillStyle = "white"; ctx.font = "18px monospace"; ctx.fillText("SYNTHETIC CAMERA", 55, 195);
        };
        draw();
        const track = canvas.captureStream(8).getVideoTracks()[0];
        const timer = setInterval(draw, 120), stop = track.stop.bind(track);
        track.stop = () => { clearInterval(timer); active.delete(track); stop(); };
        active.add(track); stream.addTrack(track);
      }
      if (constraints.audio) {
        const context = new AudioContext();
        const oscillator = context.createOscillator(), gain = context.createGain(), destination = context.createMediaStreamDestination();
        oscillator.frequency.value = 440; gain.gain.value = .03;
        oscillator.connect(gain); gain.connect(destination); oscillator.start();
        await context.resume();
        const track = destination.stream.getAudioTracks()[0], stop = track.stop.bind(track);
        track.stop = () => { if (active.delete(track)) { oscillator.stop(); context.close(); stop(); } };
        active.add(track); stream.addTrack(track);
      }
      return stream;
    };
    window.addEventListener("pagehide", () => [...active].forEach(track => track.stop()));
  });
};
