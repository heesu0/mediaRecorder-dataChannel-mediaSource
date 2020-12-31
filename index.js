'use strict'

const express = require('express');
const app = express();
const server = require('http').createServer(app).listen(8080);
const io = require('socket.io').listen(server);
const path = require('path');

app.get('/', function (req, res) {
    res.sendFile(path.join(__dirname, '/index.html'));
})

app.use('/js', express.static(path.join(__dirname, '/js')));
app.use('/css', express.static(path.join(__dirname, '/css')));

io.sockets.on('connection', function (socket) {
    function log() {
        const array = ['Message from server : '];
        array.push.apply(array, arguments);
        socket.emit('log', array);
    }

    socket.on('message', function (message, room) {
        log('Client said : ', message);
        //socket.broadcast.to(room).emit('message', message);
        socket.broadcast.emit('message', message);
    });

    socket.on('create or join', function (room) {
        log('Received request to create or join room' + room);

        const clientsInRoom = io.sockets.adapter.rooms[room];
        const numClients = numClientsInRoom(clientsInRoom, room);
        
        if (numClients === 0) {
            log('Client ID ' + socket.id + 'created room' + room);
            socket.join(room);
            socket.emit('created', room, socket.id);
        }
        else if (numClients == 1) {
            log('Client ID ' + socket.id + 'joined room' + room);
            socket.join(room);
            socket.emit('joined', room, socket.id);
            io.sockets.in(room).emit('ready');
        }
        else {
            socket.emit('full', room);
        }
    });

    socket.on('disconnect', function (event) {
        console.log(`Peer or Server disconnected. Reason : ${event}`);
        socket.broadcast.emit('bye');
    });

    socket.on('bye', function (room) {
        console.log(`Peer said bye on room ${room}`);
    });

});

function numClientsInRoom(clientsInRoom, room) {
    if (clientsInRoom === undefined) {
        console.log('Make room : ', room);
        return 0;
    }
    else {
        console.log('Join room : ', room);
        return clientsInRoom.length;
    }
}