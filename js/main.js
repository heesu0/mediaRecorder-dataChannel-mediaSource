'use strict';

/******************************************************
 * Initial setup
 ******************************************************/

const configuration = null;
/*const configuration = {
   'iceServers': [{
     'urls': 'stun:stun.l.google.com:19302'
   }]
};*/
const mediaSource = new MediaSource();
const localVideo = document.querySelector('video#localVideo');
const remoteVideo = document.querySelector('video#remoteVideo');
const streamingBtn = document.querySelector('button#streamingBtn');
const callbackQueue = [];

// Options that work similarly to udp (i'm not sure if it works)
const dataConstraint = {
    ordered: false,
    maxRetransmits: 0
};

let sourceBuffer;
let mediaRecorder;
let isInitiator; 
let room = window.location.hash.substring(1);

streamingBtn.onclick = toggleStreaming;
streamingBtn.disabled = true;

// / Check if the room is in the URL
if (!room) {
    room = window.location.hash = prompt('Enter a room name:');
}

/******************************************************
 * Signaling server
 ******************************************************/

// Connect to the signaling server
const socket = io.connect();

// The client tries to create or join a room, only if the room is not blank
if (room !== '') {
    socket.emit('create or join', room);
    console.log('Attempted to create or join room', room);
}
else { // Create a random room if room is empty 
    room = window.location.hash = randomToken();
    alert('Room name is empty! We will create a new room for you : ', room);
}

socket.on('created', function (room, clientId) {
    console.log('Created room', room, '- my client ID is', clientId);
    isInitiator = true;
});

socket.on('joined', function (room, clientId) {
    console.log('This peer has joined room', room, 'with client ID', clientId);
    isInitiator = false;
    // Why? 'ready' create peerConnection
    // createPeerConnection(isInitiator, configuration);
});

socket.on('full', function (room) {
    alert('Room ' + room + ' is full!');
    window.location.hash = '';
    window.location.reload();
});

socket.on('ready', function () {
    console.log('Socket is ready');
    createPeerConnection(isInitiator, configuration);
});

socket.on('play', function () {
    remoteVideo.play();
});

socket.on('log', function (array) {
    console.log.apply(console, array);
});

socket.on('message', function (message) {
    console.log('Client received message:', message);
    signalingMessageCallback(message);
});

// Leaving rooms and disconnecting from peers.
socket.on('disconnect', function (reason) {
    console.log(`Disconnected: ${reason}.`);
    streamingBtn.disabled = true;
});

socket.on('bye', function (room) {
    console.log(`Peer leaving room ${room}.`);
    streamingBtn.disabled = true;
    // If peer did not create the room, re-enter to be creator.
    if (!isInitiator) {
        window.location.reload();
    }
});

window.addEventListener('unload', function () {
    console.log(`Unloading window. Notifying peers in ${room}.`);
    socket.emit('bye', room);
});

// Send message to signaling server
function sendMessage(message) {
    console.log('Client sending message: ', message);
    socket.emit('message', message, room);
}

/******************************************************
 * Media part (getUserMedia, mediaSource)
 ******************************************************/

navigator.mediaDevices.getUserMedia({
    audio: true,
    video: true
})
.then(gotStream)
.catch(function (e) {
    alert('getUserMedia() error: ' + e.name);
});

function gotStream(stream) {
    console.log('getUserMedia video stream URL:', stream);
    window.stream = stream;
    localVideo.srcObject = stream;
}

let isMediaInit = false;

mediaSource.addEventListener('sourceopen', function (e) {
    //const mimeCodec = 'video/mp4; codecs="avc1.42E01E, opus"';
    const mimeCodec = 'video/webm; codecs="vp8, opus"';
    sourceBuffer = mediaSource.addSourceBuffer(mimeCodec);
    sourceBuffer.mode = 'segments'; // 
    sourceBuffer.addEventListener('updateend', function () {

        // Update if currentTime is slower than 1 second from the time currently buffered in sourceBuffer
        if (isMediaInit) {
            const ranges = sourceBuffer.buffered;
            const bufferLength = ranges.length;
            if (bufferLength != 0) {
                if (sourceBuffer.buffered.end(0) - remoteVideo.currentTime > 1) {
                    remoteVideo.currentTime = sourceBuffer.buffered.end(0);
                    console.log("Update currentTime!!!!");
                }
            }
        } else {
            isMediaInit = true;
        }

        // Append buffer to sourceBuffer if sourceBuffer is not updating 
        if (callbackQueue.length > 0 && !sourceBuffer.updating) {
            sourceBuffer.appendBuffer(callbackQueue.shift());
            console.log('Delayed buffer fix');
        }
    });
}, false);

remoteVideo.src = window.URL.createObjectURL(mediaSource);

 /******************************************************
 * WebRTC peer connection and data channel
 ******************************************************/

let peerConn;
let dataChannel;

function signalingMessageCallback(message) {
    if (message == null) return;

    if (message.type === 'offer') {
        console.log('Got offer. Sending answer to peer.');
        peerConn.setRemoteDescription(new RTCSessionDescription(message), function () { },
            logError);
        peerConn.createAnswer(onLocalSessionCreated, logError);
    } else if (message.type === 'answer') {
        console.log('Got answer.');
        peerConn.setRemoteDescription(new RTCSessionDescription(message), function () { },
            logError);
    } else if (message.type === 'candidate') {
        console.log('Got Candidate')
        peerConn.addIceCandidate(new RTCIceCandidate({
            candidate: message.candidate,
            sdpMLineIndex: message.label,
            sdpMid: message.id
        }));
    }
}

function createPeerConnection(isInitiator, config) {
    console.log('Creating Peer connection as initiator?', isInitiator, 'config:',
        config);
    peerConn = new RTCPeerConnection(config);

    // Send any ice candidates to the other peer
    peerConn.onicecandidate = function (event) {
        //console.log('send ice candidates to the other peer ', event);
        //console.log('icecandidate event:', event);
        if (event.candidate) {
            sendMessage({
                type: 'candidate',
                label: event.candidate.sdpMLineIndex,
                id: event.candidate.sdpMid,
                candidate: event.candidate.candidate
            });
        } else {
            console.log('End of candidates.');
        }
    };

    if (isInitiator) {
        console.log('Creating Data Channel');
        dataChannel = peerConn.createDataChannel('video', dataConstraint);
        onDataChannelCreated(dataChannel);

        console.log('Creating an offer');
        peerConn.createOffer().then(function (offer) {
            return peerConn.setLocalDescription(offer);
        })
        .then(() => {
            console.log('sending local desc 1');
            //console.log('sending local desc:', peerConn.localDescription);
            sendMessage(peerConn.localDescription);
        })
        .catch(logError);

    } else {
        peerConn.ondatachannel = function (event) {
            //console.log('ondatachannel:', event.channel);
            dataChannel = event.channel;
            onDataChannelCreated(dataChannel);
        };
    }
}

function onLocalSessionCreated(desc) {
    console.log('local session created');
    //console.log('local session created:', desc);
    peerConn.setLocalDescription(desc).then(function () {
        console.log('sending local desc 2');
        //console.log('sending local desc:', peerConn.localDescription);
        sendMessage(peerConn.localDescription);
    }).catch(logError);
}

function onDataChannelCreated(channel) {
    console.log('onDataChannelCreated:', channel);

    channel.onopen = function () {
        console.log('CHANNEL opened!!!');
        streamingBtn.disabled = false;
    };

    channel.onclose = function () {
        console.log('Channel closed.');
        streamingBtn.disabled = true;
    }

    channel.onmessage = onReceiveMessageCallback;
}

function onReceiveMessageCallback(event) {
    if (mediaSource.readyState == 'open') {
        const arrayBuffer = new Uint8Array(event.data);
        if (!sourceBuffer.updating && callbackQueue.length == 0) {
            sourceBuffer.appendBuffer(arrayBuffer);
        } else {
            callbackQueue.push(arrayBuffer);
        }
    }
}

function logError(err) {
    if (!err) return;
    if (typeof err === 'string') {
        console.warn(err);
    } else {
        console.warn(err.toString(), err);
    }
}
 /******************************************************
 * Streaming(Recording) part
 ******************************************************/

function toggleStreaming() {
    if (streamingBtn.textContent === 'Start Streaming') {
        startStreaming();
    } else {
        stopStreaming();
        streamingBtn.textContent = 'Start Streaming';
    }
}

function startStreaming() {
    // let options = { mimeType: 'video/webm; codecs="h264, opus"' };
    let options = { mimeType: 'video/webm; codecs="vp8, opus"' };
    try {
        mediaRecorder = new MediaRecorder(window.stream, options);
    } catch (e0) {
        console.log('Unable to createm MediaRecorder with options Object: ', e0);
        try {
            options = { mimeType: 'video/webm,codecs=vp8'};
            mediaRecorder = new MediaRecorder(window.stream, options);
        } catch (e1) {
            console.log('Unable to create MediaRecorder with options Object: ', e1);
            try {
                options = 'video/vp8'; // Chrome 47
                mediaRecorder = new MediaRecorder(window.stream, options);
            } catch (e2) {
                alert('MediaRecorder is not supported by this browser.\n\n' +
                    'Try Firefox 29 or later, or Chrome 47 or later, with Enable experimental Web Platform features enabled from chrome://flags.');
                console.error('Exception while creating MediaRecorder:', e2);
                return;
            }
        }
    }
    console.log('Created MediaRecorder', mediaRecorder, 'with options', options);
    streamingBtn.textContent = 'Stop Streaming';
    mediaRecorder.onstop = handleStop;
    mediaRecorder.ondataavailable = handleDataAvailable;
    mediaRecorder.start(1); // time slice 1ms
    socket.emit('streaming', room);
    console.log('MediaRecorder started', mediaRecorder);
}

async function handleDataAvailable(event) {
    if (event.data && event.data.size > 0) {
        // Sending a blob data through RTCPeerConnection is not supported. why?
        const buffer = await event.data.arrayBuffer();
        dataChannel.send(buffer);
    }
}

function handleStop(event) {
    console.log('Recorder stopped: ', event);
}

function stopStreaming() {
    mediaRecorder.stop();
}

 /******************************************************
 * Etc function
 ******************************************************/

function randomToken() {
    return Math.floor((1 + Math.random()) * 1e16).toString(16).substring(1);
}
