import { Component, OnInit, ChangeDetectorRef, inject, EnvironmentInjector } from '@angular/core';
import { SignalingService } from '../../services/signaling.service';

@Component({
  selector: 'app-kiosk',
  standalone: false,
  templateUrl: './kiosk.component.html',
  styleUrls: ['./kiosk.component.scss']
})
export class KioskComponent implements OnInit {
  sessionKey = 'KIOSK-ABC123';
  counters: string[] = [];
  peerConnections = new Map<string, RTCPeerConnection>();
  dataChannels = new Map<string, RTCDataChannel>();
  iceCandidateBuffer = new Map<string, RTCIceCandidateInit[]>();
  lastMessage = '';
  message = '';
  targetCounterId = '';
  debugLogs: string[] = [];
  private injector = inject(EnvironmentInjector);

  constructor(
    private signalingService: SignalingService,
    private cdr: ChangeDetectorRef
  ) {}

  async ngOnInit() {
    this.signalingService.on('session-error').subscribe(data => {
      console.error('Session error:', data.message);
      this.debugLogs.push(`Session error: ${data.message}`);
      this.cdr.detectChanges();
    });

    this.signalingService.on('counter-joined').subscribe(({ counterId }) => {
      console.log('Counter joined:', counterId);
      this.debugLogs.push(`Counter joined: ${counterId}`);
      this.counters.push(counterId);
      this.createPeerConnection(counterId);
      this.cdr.detectChanges();
    });

    this.signalingService.on('counter-left').subscribe(({ counterId }) => {
      console.log('Counter left:', counterId);
      this.debugLogs.push(`Counter left: ${counterId}`);
      this.counters = this.counters.filter(id => id !== counterId);
      this.peerConnections.get(counterId)?.close();
      this.dataChannels.get(counterId)?.close();
      this.peerConnections.delete(counterId);
      this.dataChannels.delete(counterId);
      this.cdr.detectChanges();
    });

    this.signalingService.on('offer').subscribe(async ({ from, offer }) => {
      console.log(`KIOSK got OFFER from ${from}`, offer);
      this.debugLogs.push(`KIOSK got OFFER from ${from}: ${JSON.stringify(offer)}`);
      const peerConnection = this.peerConnections.get(from);
      if (peerConnection) {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
        const bufferedCandidates = this.iceCandidateBuffer.get(from) || [];
        for (const candidate of bufferedCandidates) {
          await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
          console.log(`KIOSK applying buffered ICE from ${from}`, candidate);
          this.debugLogs.push(`KIOSK applying buffered ICE from ${from}: ${JSON.stringify(candidate)}`);
        }
        this.iceCandidateBuffer.delete(from);
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        const kioskId = await this.runInContext(() => this.signalingService.getSocketId());
        this.signalingService.emit('answer', { to: from, from: kioskId, answer });
        console.log(`KIOSK sent ANSWER to ${from}`, answer);
        this.debugLogs.push(`KIOSK sent ANSWER to ${from}: ${JSON.stringify(answer)}`);
      }
      this.cdr.detectChanges();
    });

    this.signalingService.on('ice-candidate').subscribe(async ({ from, candidate }) => {
      console.log(`KIOSK got ICE from ${from}`, candidate);
      this.debugLogs.push(`KIOSK got ICE from ${from}: ${JSON.stringify(candidate)}`);
      const peerConnection = this.peerConnections.get(from);
      if (peerConnection && peerConnection.remoteDescription) {
        await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
      } else {
        console.log(`KIOSK buffering ICE candidate for ${from}`);
        this.debugLogs.push(`KIOSK buffering ICE candidate for ${from}`);
        const bufferedCandidates = this.iceCandidateBuffer.get(from) || [];
        bufferedCandidates.push(candidate);
        this.iceCandidateBuffer.set(from, bufferedCandidates);
      }
      this.cdr.detectChanges();
    });
  }

  async createSession() {
    return this.runInContext(async () => {
      try {
        const kioskId = await this.signalingService.getSocketId();
        console.log('KIOSK socket id:', kioskId);
        this.debugLogs.push(`KIOSK socket id: ${kioskId}`);
        this.signalingService.emit('create-session', { sessionKey: this.sessionKey, kioskId });
        this.cdr.detectChanges();
      } catch (error: any) {
        console.error('Error creating session:', error);
        this.debugLogs.push(`Error creating session: ${error.message || error}`);
        this.cdr.detectChanges();
      }
    });
  }

  private async runInContext<T>(fn: () => Promise<T>): Promise<T> {
    return this.injector.runInContext(fn);
  }

  async createPeerConnection(counterId: string) {
    try {
      const iceServers = await this.signalingService.getIceServers().toPromise();
      console.log(`Creating peer connection for counter ${counterId} with ICE servers:`, iceServers);
      this.debugLogs.push(`Creating peer connection for counter ${counterId} with ICE servers: ${JSON.stringify(iceServers)}`);
      const peerConnection = new RTCPeerConnection({ iceServers });
      this.peerConnections.set(counterId, peerConnection);

      peerConnection.ondatachannel = (event) => {
        const dataChannel = event.channel;
        this.dataChannels.set(counterId, dataChannel);
        dataChannel.onopen = () => {
          console.log(`Data channel open with ${counterId}`);
          this.debugLogs.push(`Data channel open with ${counterId}`);
          this.cdr.detectChanges();
        };
        dataChannel.onmessage = (e) => {
          console.log(`KIOSK received message from ${counterId}: ${e.data}`);
          this.debugLogs.push(`KIOSK received message from ${counterId}: ${e.data}`);
          this.lastMessage = `From ${counterId}: ${e.data}`;
          this.cdr.detectChanges();
        };
        dataChannel.onclose = () => {
          console.log(`Data channel closed with ${counterId}`);
          this.debugLogs.push(`Data channel closed with ${counterId}`);
          this.cdr.detectChanges();
        };
      };

      peerConnection.onicecandidate = async (event) => {
        if (event.candidate) {
          const kioskId = await this.runInContext(() => this.signalingService.getSocketId());
          this.signalingService.emit('ice-candidate', {
            to: counterId,
            from: kioskId,
            candidate: event.candidate.toJSON()
          });
          console.log(`KIOSK sent ICE to ${counterId}`, event.candidate);
          this.debugLogs.push(`KIOSK sent ICE to ${counterId}: ${JSON.stringify(event.candidate)}`);
        }
      };

      peerConnection.oniceconnectionstatechange = () => {
        console.log(`ICE state for ${counterId}: ${peerConnection.iceConnectionState}`);
        this.debugLogs.push(`ICE state for ${counterId}: ${peerConnection.iceConnectionState}`);
        if (peerConnection.iceConnectionState === 'failed') {
          peerConnection.restartIce();
        }
        this.cdr.detectChanges();
      };
    } catch (error: any) {
      console.error(`Failed to create peer connection for ${counterId}:`, error);
      this.debugLogs.push(`Failed to create peer connection for ${counterId}: ${error.message || error}`);
      this.cdr.detectChanges();
    }
  }

  sendMessage() {
    const dataChannel = this.dataChannels.get(this.targetCounterId);
    if (dataChannel && dataChannel.readyState === 'open') {
      dataChannel.send(this.message);
      console.log(`KIOSK sent message to ${this.targetCounterId}: ${this.message}`);
      this.debugLogs.push(`KIOSK sent message to ${this.targetCounterId}: ${this.message}`);
      this.message = '';
      this.cdr.detectChanges();
    }
  }
}
