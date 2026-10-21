# docs/BACKLOG.md — sample shape (made-up game, made-up counts)

The real ledger is edited only with `npm run issue`. `Plain:` is the user-readable line on the board;
`Gate:` is how we know it is done; the board computes % from the Timeline — never type one by hand.

## Timeline

### [S0] Research
Plain: Find out which files the game has, what engine runs them, and what tools already exist.
Tickets: U1, R1, R2
Weight: 10

### [S1] Safe repo and extraction
Plain: Set up a project that can never leak game files, then read the game's archives with exact counts.
Tickets: E1, E2
Weight: 10

### [S2] Boots without a window
Plain: The game's own logic runs on the computer (no window) as far as the title screen.
Tickets: E3
Weight: 15

### [S3] Pictures and words right
Plain: Every screen draws like the real game — backgrounds, characters, words, effects.
Tickets:
Weight: 20

### [S4] Playable in a browser
Plain: You can play from the first screen to every ending in a browser, with sound, saves, and menus.
Tickets:
Weight: 20
Playable: yes

### [S5] Phones and compatibility
Plain: It works well on phones (touch, sound, installable) and in every major browser.
Tickets:
Weight: 10

### [S6] Faster and smaller
Plain: Loads quickly and stays within phone memory.
Tickets:
Weight: 10

### [S7] Live
Plain: Ready to put online; you deploy it (agents never do).
Tickets:
Weight: 5

## Lanes

### Lane R — research

### [R1] Fingerprint the game files
Plain: List every file type in the game and identify the engine and its version.
Status: OPEN
Type: task
Prio: P1
Needs: U1
Gate: a fingerprint JSON in ignored re/ (engine, exe version, hashes of key files, archive magics with counts and sizes) with zero unknown magics or an explicit list

### Lane E — engine

### [E1] Content firewall before any game-derived commit
Plain: Make sure no game file or story text can ever be committed.
Status: OPEN
Type: task
Prio: P1
Needs: R1
Gate: npm run firewall knows this engine's file types and catches a planted fixture; a story-text check is planned or in place

### Lane U — for you

### [U1] Which edition, and where is it installed?
Plain: Tell us which version of the game you have and the folder it is installed in.
Status: OPEN
Type: user
