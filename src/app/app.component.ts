import { Component, ElementRef, ViewChild } from '@angular/core';
import { ConnectionQuality, ConnectionState, DisconnectReason, LocalAudioTrack, LocalParticipant, MediaDeviceFailure, Participant, ParticipantEvent, RemoteParticipant, RemoteTrackPublication, Room, RoomConnectOptions, RoomEvent, RoomOptions, Track, TrackPublication, VideoCaptureOptions, VideoCodec, VideoPreset, VideoPresets, VideoQuality } from 'livekit-client';
import { createAudioAnalyser } from 'src/utils';

export enum DataPacket_Kind {
  RELIABLE = 0,
  LOSSY = 1,
  UNRECOGNIZED = -1,
}

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss']
})

export class AppComponent {

  @ViewChild('myDiv', { static: false }) myDiv!: ElementRef;
  title = 'livekit-test';
  currentRoom: Room | undefined | any;
  roomName = "test";
  participantName = "Sohan";
  startTime!: number;
  url = "wss://livekit.getinstant.net";
  token = "";

  state = {
    isFrontFacing: false,
    encoder: new TextEncoder(),
    decoder: new TextDecoder(),
    defaultDevices: new Map<MediaDeviceKind, string>(),
    bitrateInterval: undefined as any,
  }

  elementMapping: { [k: string]: MediaDeviceKind } = {
    'video-input': 'videoinput',
    'audio-input': 'audioinput',
    'audio-output': 'audiooutput',
  };

  $ = (id: string) => document.getElementById(id);

  constructor() {

  }


  ngAfterViewInit() {
    console.log(this.myDiv.nativeElement); // Output: "Hello, world!"
  }

  async ngOnInit() {

    this.acquireDeviceList();


    // this.at.addGrant({
    //   roomJoin: true,
    //   room: this.roomName,
    //   canPublish: true,
    //   canSubscribe: true
    // })


    // this.room = new Room({
    //   adaptiveStream: true,
    //   dynacast: true
    // });
    // this.room.connect(this.url, this.token, {
    //   autoSubscribe: true
    // })
  }

  appActions = {
    connectWithFormInput: async () => {
      const url = (<HTMLInputElement>this.$('url')).value;
      const token = (<HTMLInputElement>this.$('token')).value;
      const simulcast = (<HTMLInputElement>this.$('simulcast')).checked;
      const dynacast = (<HTMLInputElement>this.$('dynacast')).checked;
      const forceTURN = (<HTMLInputElement>this.$('force-turn')).checked;
      const adaptiveStream = (<HTMLInputElement>this.$('adaptive-stream')).checked;
      const shouldPublish = (<HTMLInputElement>this.$('publish-option')).checked;
      const preferredCodec = (<HTMLSelectElement>this.$('preferred-codec')).value as VideoCodec;
      const autoSubscribe = (<HTMLInputElement>this.$('auto-subscribe')).checked;

      const roomOpts: RoomOptions = {
        adaptiveStream,
        dynacast,
        publishDefaults: {
          simulcast,
          videoSimulcastLayers: [VideoPresets.h90, VideoPresets.h216],
          videoCodec: preferredCodec || 'vp8',
        },
        videoCaptureDefaults: {
          resolution: VideoPresets.h720.resolution,
        },
      }

      const connectOpts: RoomConnectOptions = {
        autoSubscribe: autoSubscribe,
      };

      if (forceTURN) {
        connectOpts.rtcConfig = {
          iceTransportPolicy: 'relay',
        };
      }

      await this.appActions.connectToRoom(url, token, roomOpts, connectOpts, shouldPublish);

      // this.state.bitrateInterval = setInterval(renderBitrate, 1000);
    },

    connectToRoom: async (url: string, token: string, roomOptions?: RoomOptions, connectOptions?: RoomConnectOptions,
      shouldPublish?: boolean,): Promise<Room | undefined> => {
      const room = new Room(roomOptions);
      this.startTime = Date.now();
      await room.prepareConnection(url);
      const prewarmTime = Date.now() - this.startTime;
      console.log(`prewarmed connection in ${prewarmTime}ms`);
      room
        .on(RoomEvent.ParticipantConnected, this.participantConnected)
        .on(RoomEvent.ParticipantDisconnected, this.participantDisconnected)
        .on(RoomEvent.DataReceived, this.handleData)
        .on(RoomEvent.Disconnected, this.handleRoomDisconnect)
        .on(RoomEvent.Reconnecting, () => this.appendLog('Reconnecting to room'))
        .on(RoomEvent.Reconnected, async () => {
          this.appendLog(
            'Successfully reconnected. server',
            await room.engine.getConnectedServerAddress(),
          );
        })

        .on(RoomEvent.LocalTrackPublished, (pub) => {
          const track = pub.track as LocalAudioTrack;

          if (track instanceof LocalAudioTrack) {
            const { calculateVolume } = createAudioAnalyser(track);
            setInterval(() => {
              this.$('local-volume')?.setAttribute('value', calculateVolume().toFixed(4));
            }, 200);
          }
          this.renderParticipant(room.localParticipant);
          this.updateButtonsForPublishState();
          this.renderScreenShare(room);
        })

        .on(RoomEvent.LocalTrackUnpublished, () => {
          this.renderParticipant(room.localParticipant);
          this.updateButtonsForPublishState();
          this.renderScreenShare(room);
        })
        .on(RoomEvent.MediaDevicesChanged, this.handleDevicesChanged)
        .on(RoomEvent.AudioPlaybackStatusChanged, () => {
          if (room.canPlaybackAudio) {
            this.$('start-audio-button')?.setAttribute('disabled', 'true');
          } else {
            this.$('start-audio-button')?.removeAttribute('disabled');
          }
        })
        .on(RoomEvent.MediaDevicesError, (e: Error) => {
          const failure = MediaDeviceFailure.getFailure(e);
          console.log('media device failure', failure);
        })
        .on(
          RoomEvent.ConnectionQualityChanged,
          (quality: ConnectionQuality, participant?: Participant) => {
            console.log('connection quality changed', participant?.identity, quality);
          },
        )
        .on(RoomEvent.TrackSubscribed, (track, pub, participant) => {
          console.log('subscribed to track', pub.trackSid, participant.identity);
          this.renderParticipant(participant);
          this.renderScreenShare(room);
        })
        .on(RoomEvent.TrackUnsubscribed, (_, pub, participant) => {
          console.log('unsubscribed from track', pub.trackSid);
          this.renderParticipant(participant);
          this.renderScreenShare(room);
        })
        .on(RoomEvent.SignalConnected, async () => {
          const signalConnectionTime = Date.now() - this.startTime;
          console.log(`signal connection established in ${signalConnectionTime}ms`);
          // speed up publishing by starting to publish before it's fully connected
          // publishing is accepted as soon as signal connection has established
          if (shouldPublish) {
            await room.localParticipant?.enableCameraAndMicrophone();
            console.log(`tracks published in ${Date.now() - this.startTime}ms`);
            this.updateButtonsForPublishState();
          }
        });

      try {
        await room.connect(url, token, connectOptions);
        const elapsed = Date.now() - this.startTime;

        console.log(
          `successfully connected to ${room.name} in ${Math.round(elapsed)}ms`,
          await room.engine.getConnectedServerAddress(),
        );
      } catch (error: any) {
        let message: any = error;

        console.log(error);

        if (error.message) {
          message = error.message;
        }
        this.appendLog('could not connect:', message);
        return;
      }
      this.currentRoom = room;
      window.currentRoom = room;
      this.setButtonsForState(true);
      room.participants.forEach((participant) => {
        this.participantConnected(participant);
      });
      this.participantConnected(room.localParticipant);

      return room;
    },

    disconnectRoom: () => {
      console.log("disconnected");

      if (this.currentRoom) {
        this.currentRoom.disconnect();
      }
      if (this.state.bitrateInterval) {
        clearInterval(this.state.bitrateInterval);
      }
    },

    toggleAudio: async () => {
      if (!this.currentRoom) return;
      const enabled = this.currentRoom.localParticipant.isMicrophoneEnabled;
      this.setButtonDisabled('toggle-audio-button', true);
      if (enabled) {
        this.appendLog('disabling audio');
      } else {
        this.appendLog('enabling audio');
      }
      await this.currentRoom.localParticipant.setMicrophoneEnabled(!enabled);
      this.setButtonDisabled('toggle-audio-button', false);
      this.updateButtonsForPublishState();
    },

    toggleVideo: async () => {
      if (!this.currentRoom) return;
      this.setButtonDisabled('toggle-video-button', true);
      const enabled = this.currentRoom.localParticipant.isCameraEnabled;
      if (enabled) {
        this.appendLog('disabling video');
      } else {
        this.appendLog('enabling video');
      }
      await this.currentRoom.localParticipant.setCameraEnabled(!enabled);
      this.setButtonDisabled('toggle-video-button', false);
      this.renderParticipant(this.currentRoom.localParticipant);

      // update display
      this.updateButtonsForPublishState();
    },

    handleScenario: (e: Event) => {
      const scenario = (<HTMLSelectElement>e.target).value;
      if (scenario === 'subscribe-all') {
        this.currentRoom?.participants.forEach((p: any) => {
          p.tracks.forEach((rp: any) => rp.setSubscribed(true));
        });
      } else if (scenario === 'unsubscribe-all') {
        this.currentRoom?.participants.forEach((p: any) => {
          p.tracks.forEach((rp: any) => rp.setSubscribed(false));
        });
      } else if (scenario !== '') {
        this.currentRoom?.simulateScenario(scenario);
        (<HTMLSelectElement>e.target).value = '';
      }
    },

    handleDeviceSelected: async (e: Event) => {
      const deviceId = (<HTMLSelectElement>e.target).value;
      const elementId = (<HTMLSelectElement>e.target).id;
      const kind = this.elementMapping[elementId];
      if (!kind) {
        return;
      }

      this.state.defaultDevices.set(kind, deviceId);

      if (this.currentRoom) {
        await this.currentRoom.switchActiveDevice(kind, deviceId);
      }
    },

    handlePreferredQuality: (e: Event) => {
      const quality = (<HTMLSelectElement>e.target).value;
      let q = VideoQuality.HIGH;
      switch (quality) {
        case 'low':
          q = VideoQuality.LOW;
          break;
        case 'medium':
          q = VideoQuality.MEDIUM;
          break;
        case 'high':
          q = VideoQuality.HIGH;
          break;
        default:
          break;
      }
      if (this.currentRoom) {
        this.currentRoom.participants.forEach((participant: any) => {
          participant.tracks.forEach((track: any) => {
            track.setVideoQuality(q);
          });
        });
      }
    },

    handlePreferredFPS: (e: Event) => {
      const fps = +(<HTMLSelectElement>e.target).value;
      if (this.currentRoom) {
        this.currentRoom.participants.forEach((participant: any) => {
          participant.tracks.forEach((track: any) => {
            track.setVideoFPS(fps);
          });
        });
      }
    },

    flipVideo: () => {
      const videoPub = this.currentRoom?.localParticipant.getTrack(Track.Source.Camera);
      if (!videoPub) {
        return;
      }
      if (this.state.isFrontFacing) {
        this.setButtonState('flip-video-button', 'Front Camera', false);
      } else {
        this.setButtonState('flip-video-button', 'Back Camera', false);
      }
      this.state.isFrontFacing = !this.state.isFrontFacing;
      const options: VideoCaptureOptions = {
        resolution: VideoPresets.h720.resolution,
        facingMode: this.state.isFrontFacing ? 'user' : 'environment',
      };
      videoPub.videoTrack?.restartTrack(options);
    },

    shareScreen: async () => {
      if (!this.currentRoom) return;

      const enabled = this.currentRoom.localParticipant.isScreenShareEnabled;
      this.appendLog(`${enabled ? 'stopping' : 'starting'} screen share`);
      this.setButtonDisabled('share-screen-button', true);
      await this.currentRoom.localParticipant.setScreenShareEnabled(!enabled, { audio: true });
      this.setButtonDisabled('share-screen-button', false);
      this.updateButtonsForPublishState();
    },

    startAudio: () => {
      this.currentRoom?.startAudio();
    },

    enterText: () => {
      if (!this.currentRoom) return;
      const textField = <HTMLInputElement>this.$('entry');
      if (textField.value) {
        const msg = this.state.encoder.encode(textField.value);
        this.currentRoom.localParticipant.publishData(msg, DataPacket_Kind.RELIABLE);
        (<HTMLTextAreaElement>(
          this.$('chat')
        )).value += `${this.currentRoom.localParticipant.identity} (me): ${textField.value}\n`;
        textField.value = '';
      }
    },

  }

  appendLog(...args: any[]) {
    const logger = this.$('log')!;
    for (let i = 0; i < arguments.length; i += 1) {
      if (typeof args[i] === 'object') {
        logger.innerHTML += `${JSON && JSON.stringify ? JSON.stringify(args[i], undefined, 2) : args[i]
          } `;
      } else {
        logger.innerHTML += `${args[i]} `;
      }
    }
    logger.innerHTML += '\n';
    (() => {
      logger.scrollTop = logger.scrollHeight;
    })();
  }

  setButtonState(
    buttonId: string,
    buttonText: string,
    isActive: boolean,
    isDisabled: boolean | undefined = undefined,
  ) {
    const el = this.$(buttonId) as HTMLButtonElement;
    if (!el) return;
    if (isDisabled !== undefined) {
      el.disabled = isDisabled;
    }
    el.innerHTML = buttonText;
    if (isActive) {
      el.classList.add('active');
    } else {
      el.classList.remove('active');
    }
  }

  setButtonDisabled(buttonId: string, isDisabled: boolean) {
    const el = this.$(buttonId) as HTMLButtonElement;
    el.disabled = isDisabled;
  }

  setButtonsForState(connected: boolean) {
    const connectedSet = [
      'toggle-video-button',
      'toggle-audio-button',
      'share-screen-button',
      'disconnect-ws-button',
      'disconnect-room-button',
      'flip-video-button',
      'send-button',
    ];
    const disconnectedSet = ['connect-button'];

    const toRemove = connected ? connectedSet : disconnectedSet;
    const toAdd = connected ? disconnectedSet : connectedSet;

    toRemove.forEach((id) => this.$(id)?.removeAttribute('disabled'));
    toAdd.forEach((id) => this.$(id)?.setAttribute('disabled', 'true'));
  }

  participantConnected(participant: Participant) {
    console.log('participant', participant.identity, 'connected', participant.metadata);
    participant
      .on(ParticipantEvent.TrackMuted, (pub: TrackPublication) => {
        this.appendLog('track was muted', pub.trackSid, participant.identity);
        this.renderParticipant(participant);
      })
      .on(ParticipantEvent.TrackUnmuted, (pub: TrackPublication) => {
        this.appendLog('track was unmuted', pub.trackSid, participant.identity);
        this.renderParticipant(participant);
      })
      .on(ParticipantEvent.IsSpeakingChanged, () => {
        this.renderParticipant(participant);
      })
      .on(ParticipantEvent.ConnectionQualityChanged, () => {
        this.renderParticipant(participant);
      });
  }

  participantDisconnected(participant: RemoteParticipant) {
    this.appendLog('participant', participant.sid, 'disconnected');

    this.renderParticipant(participant, true);
  }

  handleRoomDisconnect(reason?: DisconnectReason) {
    if (!this.currentRoom) return;
    this.appendLog('disconnected from room', { reason });
    this.setButtonsForState(false);
    this.renderParticipant(this.currentRoom.localParticipant, true);
    this.currentRoom.participants.forEach((p: any) => {
      this.renderParticipant(p, true);
    });
    this.renderScreenShare(this.currentRoom);

    const container = this.$('participants-area');
    if (container) {
      container.innerHTML = '';
    }

    // clear the chat area on disconnect
    const chat = <HTMLTextAreaElement>this.$('chat');
    chat.value = '';

    this.currentRoom = undefined;
    window.currentRoom = undefined;
  }


  // 

  handleData(msg: Uint8Array, participant?: RemoteParticipant) {

    const str = this.state.decoder.decode(msg);
    const chat = <HTMLTextAreaElement>this.$('chat');
    let from = 'server';
    if (participant) {
      from = participant.identity;
    }
    chat.value += `${from}: ${str}\n`;
  }

  // updates participant UI
  renderParticipant(participant: Participant, remove: boolean = false) {
    const container = this.$('participants-area');
    if (!container) return;
    const { identity } = participant;
    let div = this.$(`participant-${identity}`);
    if (!div && !remove) {
      div = document.createElement('div');
      div.id = `participant-${identity}`;
      div.className = 'participant';
      div.innerHTML = `
      <video id="video-${identity}"></video>
      <audio id="audio-${identity}"></audio>
      <div class="info-bar">
        <div id="name-${identity}" class="name">
        </div>
        <div style="text-align: center;">
          <span id="codec-${identity}" class="codec">
          </span>
          <span id="size-${identity}" class="size">
          </span>
          <span id="bitrate-${identity}" class="bitrate">
          </span>
        </div>
        <div class="right">
          <span id="signal-${identity}"></span>
          <span id="mic-${identity}" class="mic-on"></span>
        </div>
      </div>
      ${participant instanceof RemoteParticipant
          ? `<div class="volume-control">
        <input id="volume-${identity}" type="range" min="0" max="1" step="0.1" value="1" orient="vertical" />
      </div>`
          : `<progress id="local-volume" max="1" value="0" />`
        }

    `;
      container.appendChild(div);

      const sizeElm = this.$(`size-${identity}`);
      const videoElm = <HTMLVideoElement>this.$(`video-${identity}`);
      videoElm.onresize = () => {
        this.updateVideoSize(videoElm!, sizeElm!);
      };
    }
    const videoElm = <HTMLVideoElement>this.$(`video-${identity}`);
    const audioELm = <HTMLAudioElement>this.$(`audio-${identity}`);
    if (remove) {
      div?.remove();
      if (videoElm) {
        videoElm.srcObject = null;
        videoElm.src = '';
      }
      if (audioELm) {
        audioELm.srcObject = null;
        audioELm.src = '';
      }
      return;
    }

    // update properties
    this.$(`name-${identity}`)!.innerHTML = participant.identity;
    if (participant instanceof LocalParticipant) {
      this.$(`name-${identity}`)!.innerHTML += ' (you)';
    }
    const micElm = this.$(`mic-${identity}`)!;
    const signalElm = this.$(`signal-${identity}`)!;
    const cameraPub = participant.getTrack(Track.Source.Camera);
    const micPub = participant.getTrack(Track.Source.Microphone);
    if (participant.isSpeaking) {
      div!.classList.add('speaking');
    } else {
      div!.classList.remove('speaking');
    }

    if (participant instanceof RemoteParticipant) {
      const volumeSlider = <HTMLInputElement>this.$(`volume-${identity}`);
      volumeSlider.addEventListener('input', (ev) => {
        participant.setVolume(Number.parseFloat((ev.target as HTMLInputElement).value));
      });
    }

    const cameraEnabled = cameraPub && cameraPub.isSubscribed && !cameraPub.isMuted;
    if (cameraEnabled) {
      if (participant instanceof LocalParticipant) {
        // flip
        videoElm.style.transform = 'scale(-1, 1)';
      } else if (!cameraPub?.videoTrack?.attachedElements.includes(videoElm)) {
        const renderStartTime = Date.now();
        // measure time to render
        videoElm.onloadeddata = () => {
          const elapsed = Date.now() - renderStartTime;
          let fromJoin = 0;
          if (participant.joinedAt && participant.joinedAt.getTime() < this.startTime) {
            fromJoin = Date.now() - this.startTime;
          }
          this.appendLog(
            `RemoteVideoTrack ${cameraPub?.trackSid} (${videoElm.videoWidth}x${videoElm.videoHeight}) rendered in ${elapsed}ms`,
            fromJoin > 0 ? `, ${fromJoin}ms from start` : '',
          );
        };
      }
      cameraPub?.videoTrack?.attach(videoElm);
    } else {
      // clear information display
      this.$(`size-${identity}`)!.innerHTML = '';
      if (cameraPub?.videoTrack) {
        // detach manually whenever possible
        cameraPub.videoTrack?.detach(videoElm);
      } else {
        videoElm.src = '';
        videoElm.srcObject = null;
      }
    }

    const micEnabled = micPub && micPub.isSubscribed && !micPub.isMuted;
    if (micEnabled) {
      if (!(participant instanceof LocalParticipant)) {
        // don't attach local audio
        audioELm.onloadeddata = () => {
          if (participant.joinedAt && participant.joinedAt.getTime() < this.startTime) {
            const fromJoin = Date.now() - this.startTime;
            this.appendLog(`RemoteAudioTrack ${micPub?.trackSid} played ${fromJoin}ms from start`);
          }
        };
        micPub?.audioTrack?.attach(audioELm);
      }
      micElm.className = 'mic-on';
      micElm.innerHTML = '<i class="fas fa-microphone"></i>';
    } else {
      micElm.className = 'mic-off';
      micElm.innerHTML = '<i class="fas fa-microphone-slash"></i>';
    }

    switch (participant.connectionQuality) {
      case ConnectionQuality.Excellent:
      case ConnectionQuality.Good:
      case ConnectionQuality.Poor:
        signalElm.className = `connection-${participant.connectionQuality}`;
        signalElm.innerHTML = '<i class="fas fa-circle"></i>';
        break;
      default:
        signalElm.innerHTML = '';
      // do nothing
    }
  }

  renderScreenShare(room: Room) {
    const div = this.$('screenshare-area')!;
    if (room.state !== ConnectionState.Connected) {
      div.style.display = 'none';
      return;
    }
    let participant: Participant | undefined;
    let screenSharePub: TrackPublication | undefined = room.localParticipant.getTrack(
      Track.Source.ScreenShare,
    );
    let screenShareAudioPub: RemoteTrackPublication | undefined;
    if (!screenSharePub) {
      room.participants.forEach((p) => {
        if (screenSharePub) {
          return;
        }
        participant = p;
        const pub = p.getTrack(Track.Source.ScreenShare);
        if (pub?.isSubscribed) {
          screenSharePub = pub;
        }
        const audioPub = p.getTrack(Track.Source.ScreenShareAudio);
        if (audioPub?.isSubscribed) {
          screenShareAudioPub = audioPub;
        }
      });
    } else {
      participant = room.localParticipant;
    }

    if (screenSharePub && participant) {
      div.style.display = 'block';
      const videoElm = <HTMLVideoElement>this.$('screenshare-video');
      screenSharePub.videoTrack?.attach(videoElm);
      if (screenShareAudioPub) {
        screenShareAudioPub.audioTrack?.attach(videoElm);
      }
      videoElm.onresize = () => {
        this.updateVideoSize(videoElm, <HTMLSpanElement>this.$('screenshare-resolution'));
      };
      const infoElm = this.$('screenshare-info')!;
      infoElm.innerHTML = `Screenshare from ${participant.identity}`;
    } else {
      div.style.display = 'none';
    }
  }



  handleDevicesChanged() {
    Promise.all(
      Object.keys(this.elementMapping).map(async (id) => {
        const kind = this.elementMapping[id];
        if (!kind) {
          return;
        }
        const devices = await Room.getLocalDevices(kind);
        const element = <HTMLSelectElement>this.$(id);
        this.populateSelect(element, devices, this.state.defaultDevices.get(kind));
      }),
    );
  }

  populateSelect(
    element: HTMLSelectElement,
    devices: MediaDeviceInfo[],
    selectedDeviceId?: string,
  ) {
    // clear all elements
    element.innerHTML = '';

    for (const device of devices) {
      const option = document.createElement('option');
      option.text = device.label;
      option.value = device.deviceId;
      if (device.deviceId === selectedDeviceId) {
        option.selected = true;
      }
      element.appendChild(option);
    }
  }

  updateVideoSize(element: HTMLVideoElement, target: HTMLElement) {
    target.innerHTML = `(${element.videoWidth}x${element.videoHeight})`;
  }

  updateButtonsForPublishState() {
    if (!this.currentRoom) {
      return;
    }
    const lp = this.currentRoom.localParticipant;

    // video
    this.setButtonState(
      'toggle-video-button',
      `${lp.isCameraEnabled ? 'Disable' : 'Enable'} Video`,
      lp.isCameraEnabled,
    );

    // audio
    this.setButtonState(
      'toggle-audio-button',
      `${lp.isMicrophoneEnabled ? 'Disable' : 'Enable'} Audio`,
      lp.isMicrophoneEnabled,
    );

    // screen share
    this.setButtonState(
      'share-screen-button',
      lp.isScreenShareEnabled ? 'Stop Screen Share' : 'Share Screen',
      lp.isScreenShareEnabled,
    );
  }

  async acquireDeviceList() {
    this.handleDevicesChanged();
  }

}
