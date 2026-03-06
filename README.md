[Game Website Development README.md](https://github.com/user-attachments/files/25784916/Game.Website.Development.README.md)
# Six in a Row — Hexagonal Strategy Game

A browser-based implementation of the hexagonal "Six in a Row" game, as described by the YouTube video. Single HTML file — no dependencies, no build step, just open and play.

---

## How to Play

### Objective
Get **6 of your pieces in a row** along any of the three hexagonal axes.

### Turn Order
| Turn | Player | Moves |
|------|--------|-------|
| 1st  | X      | 1     |
| 2nd  | O      | 2     |
| 3rd  | X      | 2     |
| ...  | ...    | 2     |

This asymmetry compensates for X's first-move advantage, keeping piece counts roughly balanced.

### Threats
A **threat** forms when a player places 4 pieces in a consecutive row. Threats are highlighted in amber. Because blocking one end of a threat still leaves the other open, the opponent must use **two** moves to fully neutralize it — which is exactly 2 moves per turn.

### Momentum
The sidebar tracks **momentum** — who controls more active threats. Consistently building threats while your opponent is forced to react is the path to victory.

---

## Modes

| Mode | Description |
|------|-------------|
| **Two Players** | Local hotseat — two humans share a keyboard/screen |
| **vs Bot · Easy** | Bot picks random moves near existing pieces |
| **vs Bot · Hard** | Bot uses a threat-aware greedy evaluation function |

---

## Running the Game

```bash
# Option 1: Just open the file
open index.html

# Option 2: Serve locally (avoids any browser CORS quirks)
python3 -m http.server 8000
# then visit http://localhost:8000
```

No npm, no bundler, no framework — pure HTML/CSS/JS.

---

## Bot Feasibility

### What's implemented
The **Hard bot** uses a greedy one-ply evaluation:

```
score(move) =
  Σ own_chain_length × open_ends_multiplier
+ Σ opponent_chain_length × open_ends_multiplier (block score)
- distance_from_center × small_penalty
```

Key bonuses (approximate):
| Situation | Score |
|-----------|-------|
| Creates 6 in a row (win) | 2,000,000 |
| Blocks opponent win | 1,900,000 |
| Creates open 5 in a row | 250,000 |
| Blocks open 5 | 200,000 |
| Creates open threat (4) | 20,000 |
| Blocks open threat | 15,000 |

### What's possible but not yet implemented

| Improvement | Feasibility | Notes |
|---|---|---|
| **2-ply lookahead** | ✅ Easy | ~100 candidates × 100 = 10k evals; trivially fast |
| **Minimax (3+ ply)** | ⚠️ Moderate | Needs alpha-beta pruning; 2-move turns complicate the game tree |
| **Threat-space search** | ✅ High value | Solving threat chains rather than raw board eval; dramatically stronger |
| **MCTS** | ✅ Feasible | Monte Carlo tree search works well; harder to tune |
| **Neural network** | 🔬 Hard | Needs training data; overkill for this game |

### The main challenge
The **two-move turn structure** makes a standard minimax tree non-trivial: each "node" in the tree is actually a pair of placements for the current player, not one. This means the branching factor doubles for the second move of each turn. A proper implementation would nest two move selections per node.

**Verdict:** A significantly stronger bot (3-4 ply minimax with alpha-beta + threat-space evaluation) is absolutely achievable and would be a compelling improvement.

---

## ⌨️ Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `N` | New game |
| `R` | Reset camera to center |
| Scroll | Zoom in/out |
| Drag | Pan the board |

---

## 📁 File Structure

```
/
└── index.html    ← entire game (HTML + CSS + JS, ~500 lines)
└── README.md
```

---

## License
MIT — do whatever you like with it.
