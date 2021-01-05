# mediaRecorder-dataChannel-mediaSource
------------

## Goal


We try to test whether we can reduce latency by performing encoding and decoding independently, away from the encode-decode pipeline used in conventional WebRTC live video chat.

MediaRecorder was used for encoding and MediaSource was used for decoding.

Both data channel and web socket could transmit encoding media data, but the web socket had a latency problem with TCP-based protocols, so we used SCTP-based data channel.


## Description


Browser to browser live video chat test over WebRTC data channel. 
The encoding process used `mediaRecorder`, the decoding process used `mediaSource`, and the transfer process used `dataChannel`.

The overall process will be like this:

1. Enter the room name in the prompt
2. Signaling via web socket when two peers enter the same room (server will permit a maximum of two peers to share a room)
3. Obtain media stream using `getUserMedia` to access webcams on the local computer
4. `MediaRecorder` encodes media stream and converts it into blob data
5. Convert blob data to arrayBuffer and send it to the other peer via `dataChannel`
6. By using `appendBuffer`, appends the media buffer to the SourceBuffer in MediaSource


## Usage


#### Start the server by `npm install` and `npm start`

```
$ git clone https://github.com/Choi-Heesu/mediaRecorder-dataChannel-mediaSource.git

$ npm install
$ npm start
```

#### open http://localhost:8080 in broswer

