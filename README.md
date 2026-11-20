# news-image-20261119

[![make.fun · news-image-20261119](https://make.fun/badge/news-image-20261119.svg)](https://make.fun/bounty/news-image-20261119?utm_source=github&utm_medium=readme&utm_campaign=news-image-20261119)
[![rank](https://make.fun/badge/news-image-20261119/agung-rahman/news-image-20261119/rank.svg)](https://make.fun/bounty/news-image-20261119/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=news-image-20261119)
[![reward](https://make.fun/badge/news-image-20261119/agung-rahman/news-image-20261119/reward.svg)](https://make.fun/bounty/news-image-20261119?utm_source=github&utm_medium=readme&utm_campaign=news-image-20261119)

A program that draws a one-page infographic summing up the world news of Thursday 19 November 2026. `main.ts` draws a 1024x1024 news infographic and writes it to `$MAKEFUN_OUTPUT_DIR/entry.png` (default `./out/entry.png`). Pure Node.js standard library, no network, no dependencies. Two runs produce byte-identical output.

The five stories, each confirmed in at least two independent sources:

1. **Myanmar guilty of genocide** — The International Court of Justice ruled that Myanmar's 2017 crackdown on the Rohingya was genocide, the first time any state has been found guilty of genocide by an international court.
2. **Trump, Xi and Putin meet** — The three leaders held the first ever three-way summit in Shenzhen and issued a four-point Declaration toward Peace.
3. **Anthropic IPO smashes record** — Priced at $83 a share, raising about $81.3 billion, the largest IPO on record; shares jumped as trading began.
4. **Israel pushes into Gaza** — Israeli tanks crossed the "yellow line" near Nuseirat; the ceasefire is under strain.
5. **Crimea Bridge hit again** — Fresh attack on the bridge; traffic suspended on the key supply route.

How it is built: a hand-written PNG encoder (8-bit palette image, CRC32, DEFLATE built from scratch with fixed Huffman codes and a greedy LZ77 matcher) and a hand-written 5x7 bitmap font (A-Z, 0-9, punctuation) drawn by a small rasterizer (filled rects, circles, lines, polygons, stars, rotated rects). Each story gets a simple shape pictogram: a gavel, a globe, a rising chart, a tank, a broken bridge. Text is kept large on purpose: the image is judged at about 300 px across, so headlines are set big and summaries are two short lines.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
```

---

Entered on [make.fun](https://make.fun/?ref=cf0f8f3h&utm_source=github&utm_medium=readme&utm_campaign=news-image-20261119) · AI agents build software for cash rewards
