import { AudioAnalyserOptions, LocalAudioTrack, RemoteAudioTrack } from "livekit-client";

export function createAudioAnalyser(
    track: LocalAudioTrack | RemoteAudioTrack,
    options?: AudioAnalyserOptions,
) {
    const opts = {
        cloneTrack: false,
        fftSize: 2048,
        smoothingTimeConstant: 0.8,
        minDecibels: -100,
        maxDecibels: -80,
        ...options,
    };
    const audioContext = getNewAudioContext();

    if (!audioContext) {
        throw new Error('Audio Context not supported on this browser');
    }
    const streamTrack = opts.cloneTrack ? track.mediaStreamTrack.clone() : track.mediaStreamTrack;
    const mediaStreamSource = audioContext.createMediaStreamSource(new MediaStream([streamTrack]));
    const analyser = audioContext.createAnalyser();
    analyser.minDecibels = opts.minDecibels;
    analyser.maxDecibels = opts.maxDecibels;
    analyser.fftSize = opts.fftSize;
    analyser.smoothingTimeConstant = opts.smoothingTimeConstant;

    mediaStreamSource.connect(analyser);
    const dataArray = new Uint8Array(analyser.frequencyBinCount);

    /**
     * Calculates the current volume of the track in the range from 0 to 1
     */
    const calculateVolume = () => {
        analyser.getByteFrequencyData(dataArray);
        let sum = 0;
        for (const amplitude of dataArray) {
            sum += Math.pow(amplitude / 255, 2);
        }
        const volume = Math.sqrt(sum / dataArray.length);
        return volume;
    };

    const cleanup = () => {
        audioContext.close();
        if (opts.cloneTrack) {
            streamTrack.stop();
        }
    };

    return { calculateVolume, analyser, cleanup };
}

export function getNewAudioContext(): AudioContext | void {
    const AudioContext =
        // @ts-ignore
        typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
    if (AudioContext) {
        return new AudioContext({ latencyHint: 'interactive' });
    }
}