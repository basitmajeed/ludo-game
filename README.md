# 🎲 LUDO PRO - Multiplayer Online Board Game

A fully playable, real-time multiplayer Ludo game built with Node.js, Socket.io, and HTML5 Canvas.

Play with friends online, create private rooms, or add smart AI bots to fill up the board!

## 🌟 Key Features

- **Real-Time Multiplayer:** Instant, lag-free state synchronization using WebSockets.

- **Smart AI Bots:** Built-in heuristic AI that calculates the best moves (prioritizing winning, capturing opponents, deploying, and seeking safety).

- **Advanced Rules Engine:** Fully supports standard Ludo mechanics including:

- Capturing opponents (sends them back to base & grants an extra turn).

- Safe spots (Stars and Home stretches).

- Extra turn upon reaching the center finish line.

- The classic "Three 6s in a row cancels your turn" penalty.

- **Smooth Canvas Animations:** Pieces travel along calculated paths with smooth linear interpolation, and arc gracefully when leaving the home base.

- **Dynamic Auto-Play:** Automatically skips turns if zero moves are possible, and instantly auto-plays if you only have one valid piece to move.

- **Premium Responsive UI:** Features Glassmorphism player HUDs, dynamic color-coded toast notifications, and a glossy, 3D CSS rolling physical dice.

- **Smart Matchmaking:** Automatically assigns players to diagonal bases in 2-player games for perfect combat balance, leaving unused bases completely empty.

## 🛠️ Tech Stack

- **Backend:** Node.js, Express.js

- **Real-Time Communication:** Socket.io

- **Frontend Engine:** HTML5 Canvas API (Vanilla JS)

- **Styling:** CSS3 (Flexbox, CSS Animations, Custom Properties)

## 🚀 How to Run Locally

1. Ensure you have Node.js installed on your machine.

2. Open your terminal and navigate to your project directory:
   
   ```bash
   cd ludo-game
   ```

3. Initialize the project and install the required dependencies:

   ```bash
   npm init -y
   npm install express socket.io
   ```

4. Start the backend game engine:

   ```bash
   npm start
   ```

5. Open your web browser and navigate to:

   ```
   http://localhost:3000
   ```

6. Open a second tab or window to join your own room and test the multiplayer!

## 📁 Project Structure

```file
    ludo-game/
        ├── package.json # Dependencies and start scripts
        ├── server.js # Authoritative backend game engine & socket handler
        └── public/
            ├── index.html # Layout, lobby UI, and Canvas wrapper
            ├── style.css # Responsiveness, 3D dice animations, mobile edge-to-edge styling
            └── game.js # Canvas drawing engine, animations, and client-side
```
