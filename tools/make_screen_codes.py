"""Finds the dictionary of the markers that the calibration mode shows on the screen (screencodes.js).

A marker is 6 x 6 cells with a black ring; the inner 4 x 4 cells are a 16 bit code (bit r * 4 + c is the cell in row r, column c; 1 = black),
as in markers.js. The rules are the ones of the printed field-of-view sheet's codes (markers.js FOV_CODES):
  - no two codes closer than 4 bits (6 would leave only 13 codes in 16 bits; 4 still lets one wrong cell be read right) in any of the four turns (so one wrong cell is read right, and the turn is told),
  - no code closer than 4 bits to a turned copy of itself (it would not say which way up it is),
  - and, so that the printed sheet is never taken for a marker of the screen: none closer than 4 bits to a turn of a FOV_CODES code,
  - not (nearly) all black or all white (between 4 and 12 black cells).

    py -3 tools/make_screen_codes.py [count] [seed]

prints the codes as a JavaScript array. The same search with the same seed gives the same codes.
"""
import random
import sys

FOV_CODES = [14858, 39031, 50870, 56793]
MIN_DIST = 4


def turn(code):
    """The code seen after the marker is turned a quarter turn."""
    out = 0
    for r in range(4):
        for c in range(4):
            if (code >> (r * 4 + c)) & 1:
                nr, nc = c, 3 - r
                out |= 1 << (nr * 4 + nc)
    return out


def turns(code):
    t = [code]
    for _ in range(3):
        t.append(turn(t[-1]))
    return t


POP = [bin(i).count("1") for i in range(1 << 16)]
TURNS = [turns(c) for c in range(1 << 16)]


def dist(a, b):
    return POP[a ^ b]


def apart(a, b):
    """Closest any turn of b comes to a (all four turns of both are covered by turning one of them)."""
    return min(POP[a ^ t] for t in TURNS[b])


def ok_alone(code):
    if not 4 <= POP[code] <= 12:
        return False
    return all(dist(code, t) >= MIN_DIST for t in TURNS[code][1:])


def search(count, seed):
    rng = random.Random(seed)
    pool = [c for c in range(1, 65535) if ok_alone(c) and all(apart(c, f) >= MIN_DIST for f in FOV_CODES)]
    rng.shuffle(pool)
    picked = []
    for c in pool:
        if all(apart(c, p) >= MIN_DIST for p in picked):
            picked.append(c)
            if len(picked) == count:
                break
    return picked


if __name__ == "__main__":
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 40
    seed = int(sys.argv[2]) if len(sys.argv) > 2 else 1
    codes = search(n, seed)
    if len(codes) < n:
        print("only %d codes could be found (wanted %d)" % (len(codes), n), file=sys.stderr)
    print("[" + ", ".join(str(c) for c in codes) + "]")
