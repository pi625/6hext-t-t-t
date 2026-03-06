# Six in a Row — Hexagonal Strategy Game

Three plain files — no build step, no dependencies beyond a free PeerJS relay for online play.

```
index.html   ← all markup (home view + game view)
style.css    ← all styles
game.js      ← all logic (game, AI, rendering, network)
```

---

## Running

```bash
open index.html
# or
python3 -m http.server 8000
```

> Online play requires a server (HTTPS or localhost) due to browser WebRTC policies. `file://` won't work for the online mode, but local and bot play work anywhere.

---

## Modes

| Mode | Description |
|------|-------------|
| **Local Play** | Pass-and-play hotseat |
| **vs Bot · Medium** | 1-ply greedy AI, ~400ms think |
| **vs Bot · Hard** | 2-move pair AI (plans both moves as a unit), ~700ms think |
| **Play Online** | WebRTC peer-to-peer via 6-character room code |

---

## Rules

- Get **6 in a row** on any of the three hex axes to win
- X opens with **1 move**, then both players alternate **2 moves** per turn
- **Threat** = 4 in a row (highlighted amber) — costs the opponent 2 blocks to neutralise
- Control momentum by maintaining more threats than your opponent

---

## Online Play

Host clicks **Create** → gets a 6-character code (e.g. `HEXR42`) → shares it.  
Guest clicks **Join** → enters the code → connected.

Uses [PeerJS](https://peerjs.com/) (free public relay + WebRTC). May not work behind strict corporate firewalls. Host plays X, guest plays O.

---

## Controls

| Input | Action |
|-------|--------|
| Click | Place piece |
| Drag | Pan board |
| Scroll / Pinch | Zoom |
| `N` | New game |
| `U` or `Z` | Undo (not in online mode) |
| `R` | Re-centre view |

---

## Bot: 2-Move Pair Optimisation (Hard)

Standard greedy bots pick one move at a time. Since players make **two** moves per turn in this game, the key strategic skill is coordinating both moves — for example, placing pieces on two separate axes to create a double threat that the opponent can't fully block.

The Hard bot solves this by evaluating *pairs* of moves together:

1. Score all candidate first moves on the current board (top 60)
2. For each first move, temporarily place it and score all candidate second moves
3. Pick the pair `(m1, m2)` that maximises `score(m1) + 0.82 × score(m2)`
4. Execute with realistic thinking delays

The 0.82 discount on the second move prevents the bot from sacrificing a good first move for a marginally better second move. The pair evaluation allows it to set up double threats and fork situations that the 1-ply bot misses entirely.

---

## License
MIT
