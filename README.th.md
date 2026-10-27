# Stack Agent

Claude Code plugin และ template ที่เปลี่ยนความรู้ของทีมให้กลายเป็นโครงสร้างที่ AI agent ข้ามไม่ได้ ได้แก่ verification ที่มีหลักฐาน, guard rule แบบ ratchet, hook ที่ดักทางลัด, skill เล็กที่มี script, judge ที่ตรวจแบบไม่รู้ว่าใครทำ และ eval ที่วัดว่าทั้งหมดนี้ช่วยได้จริงหรือไม่

ใช้ได้กับโปรเจกต์ทุกประเภท มี preset สำหรับ HTTP backend, web frontend, CLI และ library ส่วนแกนกลางใช้ได้กับทุกอย่างที่ทดสอบได้ด้วยคำสั่ง จะติดตั้งเป็น plugin หรือ fork ไปแก้เป็นของตัวเองก็ได้

[English](README.md)

หัวข้อหลัก: ทำไมต้องมี · ทำงานอย่างไร · ติดตั้งในโปรเจกต์ของคุณ · ใช้ประจำวัน · แก้ปัญหา · มีอะไรบ้าง · Preset · ตัวอย่าง · ข้อกำหนดและข้อจำกัด

## ทำไมต้องมี

AI agent เขียนโค้ดได้เร็ว แต่มีสามเรื่องที่ทำให้เรายังต้องนั่งเฝ้าทุกบรรทัด:

- บอกว่า "น่าจะใช้ได้" ทั้งที่ยังไม่ได้รันอะไรเลย
- เลือกทางลัดที่สั้นที่สุดที่ compile ผ่าน จนโครงสร้างค่อยๆ เละ
- ผิดเรื่องเดิมซ้ำ เพราะกฎที่อยู่ใน prompt ลืมได้ง่าย

Stack Agent ย้ายกฎออกจาก prompt ไปไว้ในสิ่งที่ fail ให้เห็นชัด คือ verify ที่ต้องรันผ่าน, guard ที่ทำให้ CI แดง และ hook ที่หยุด agent ทันทีที่มันจะใช้ทางลัด แนวคิดมาจากทอล์กของ Lauren Tan เรื่อง pstack และวิธีที่วิศวกร Anthropic สร้าง skill ใน Claude Code ดูที่มาได้ใน [docs/th/design-notes.md](docs/th/design-notes.md)

## ทำงานอย่างไร

Stack Agent ทำงานในสามที่ สองที่แรกให้ feedback ที่เร็วกับ agent ส่วนที่สามคือด่านที่เถียงไม่ได้

| ที่ไหน | อะไรทำงาน | ไว้ทำอะไร |
| --- | --- | --- |
| **repository ของคุณ** | `.stack-agent/`: เครื่องมือ (`bin/`), config ของคุณ (`verify.json`, `guard.config.json`), กฎของคุณ และหลักฐานของ verify แต่ละรอบ | ทุกอย่างเป็นไฟล์ธรรมดาที่คุณ commit และรีวิวได้ CI รันสำเนาใน `.stack-agent/bin/` จึงไม่ต้องมี plugin |
| **session ของ agent** (hook ของ plugin ในโปรเจกต์ที่มี `.stack-agent/verify.json`) | hook รอบการแก้ไฟล์และคำสั่ง shell ทุกครั้ง และตอนที่ agent จะหยุดงาน | หยุดทางลัดที่พบบ่อยตอนที่มันเกิดขึ้น และบังคับให้ agent พิสูจน์งานของตัวเอง |
| **CI** (`.github/workflows/stack-agent.yml`) | guard, การเช็ก feature map หรือ API map และ verify ทุก push และ pull request | ด่านที่กันได้เสมอ hook เถียงได้ แต่ check สีแดงเถียงไม่ได้ |

หนึ่งการเปลี่ยนแปลงผ่านวงนี้:

```
agent edits a file ──► guard runs on that file ──► new violation? reported with the rule and the fix
        │
        ▼
agent runs verify ──► tests, your server, HTTP and command checks, the "against" step
        │               └─► evidence file, tied to a fingerprint of the code as it is now
        ▼
agent tries to stop ──► Stop hook: does the evidence match the code?
        │                 no  ──► blocked (up to 3 times in a row), told what to run
        │                 yes ──► allowed
        ▼
you open a pull request ──► CI reruns the guard (ratchet and --compare-ref) and verify (with against)
```

แนวคิดที่ทำให้มันได้ผล:

- **หลักฐาน ไม่ใช่คำบอกเล่า** `verify` รันเทสของคุณ เปิด server (ถ้ามี) รัน HTTP check และ command check แล้วเขียนบันทึกลง `.stack-agent/evidence/` บันทึกมี fingerprint ของโค้ด (ค่าเริ่มต้นไม่นับไฟล์ Markdown, `docs/` และ `.stack-agent/` ปรับรายการนี้ได้ด้วย `stopHookIgnore`) ถ้าแก้โค้ดหลัง verify หลักฐานเก่าจะไม่นับ
- **ratchet ไม่ใช่เริ่มจากศูนย์** `guard` ตรวจกฎที่คุณเขียน เป็น regex สำหรับทุกภาษา และกฎ import สำหรับ JS/TS และ Python baseline (`guard-baseline.json`) บันทึกการละเมิดที่มีอยู่ตอนนี้ ของเดิมผ่าน ของใหม่ fail และการเพิ่ม baseline ต้องให้คนใส่ `--allow-increase` ใน CI ตัว `--compare-ref` ทำให้ pull request ที่เพิ่ม baseline หรือผ่อนกฎ fail
- **check ใหม่ต้อง fail บนโค้ดเก่า** บน pull request ขั้น `against` รัน check และเทสใหม่ของคุณกับโค้ดก่อนการเปลี่ยน check ที่ผ่านบนโค้ดเก่าด้วยพิสูจน์อะไรไม่ได้ ขั้นนี้จึงให้ fail ค่าเริ่มต้น ถ้าแก้โค้ดโดยไม่มี check หรือเทสใหม่ จะได้แค่หมายเหตุและ CI ผ่าน ตั้ง `"against": { "requireNewCoverage": true }` ใน `verify.json` เพื่อให้ CI fail การเปลี่ยนที่ไม่เปลี่ยนพฤติกรรม (refactor, เปลี่ยนชื่อ) ผ่อนได้ด้วยบรรทัด `Stack-Agent-No-New-Test: <เหตุผล>` ใน commit message
- **hook ดักทางลัดที่พบบ่อย ส่วน CI ดักที่เหลือ** hook จับ pattern ของคำสั่ง ปฏิเสธ `git commit --no-verify`, `HUSKY=0` และเล่ห์เรื่อง `core.hooksPath` ถามก่อน force push, `reset --hard` หรือการแก้ config ของ guard เอง และรัน guard หลังแก้ไฟล์ทุกครั้งและกับไฟล์ที่คำสั่ง shell เปลี่ยน คนที่ตั้งใจเลี่ยงอาจหลุด hook ได้ แต่หลุด CI check ที่บังคับไม่ได้ ([docs/th/adoption.md](docs/th/adoption.md) บอกวิธีทำให้มันบังคับ)

## ติดตั้งในโปรเจกต์ของคุณ

ต้องมี Node.js 22 ขึ้นไป (ใช้รันเครื่องมือเท่านั้น โปรเจกต์ใช้ภาษาอะไรก็ได้) และ git ส่วน Claude Code จำเป็นสำหรับ hook และ skill ตัว guard และ verify รันเองได้และรันใน CI ได้

### 1. ติดตั้ง plugin

```bash
claude plugin marketplace add Brown248/Stack_Agent
```

```bash
claude plugin install stack-agent@stack-agent-marketplace
```

ค่าเริ่มต้นจะติดตั้งให้คุณในทุกโปรเจกต์ ใส่ `--scope project` ที่คำสั่งที่สองเพื่อบันทึกใน `.claude/settings.json` ของโปรเจกต์ให้ทั้งทีมใช้ หรือ `--scope local` เพื่อใช้เฉพาะโปรเจกต์นี้บนเครื่องคุณ จากนั้นเปิด Claude Code ใหม่

### 2. ตั้งค่าโปรเจกต์

เปิด Claude Code ในโปรเจกต์ของคุณแล้วรัน:

```
/stack-agent:stack-agent-init
```

มันจะถามว่า preset ไหนเหมาะ กรอก config ให้ และรันแต่ละ check จนผ่าน ถ้าจะทำเองด้วยมือ (ซึ่งเป็นวิธีใช้ Stack Agent ใน CI โดยไม่มี plugin เลยด้วย) ให้รันจาก root ของโปรเจกต์ โดยเลือก preset จาก [Preset](#preset):

```bash
node path/to/Stack_Agent/scripts/init.mjs . --preset generic
```

มันคัดลอกเครื่องมือเข้า `.stack-agent/bin/` และเพิ่ม template ของ config กับ workflow ของ GitHub Actions **เฉพาะที่ยังไม่มี** จึงรันซ้ำได้อย่างปลอดภัย มันพิมพ์สิ่งที่ทำ:

```
created   .stack-agent/bin/guard.mjs
created   .stack-agent/bin/verify.mjs
...
created  .stack-agent/guard.config.json
created  .stack-agent/verify.json
created  .github/workflows/stack-agent.yml
updated  .gitignore (+ .stack-agent/evidence/)
```

### 3. กรอกค่าที่ยังเว้นไว้

ทุกค่าที่คุณต้องตัดสินใจมีคำว่า `EDIT ME` กำกับ และ `init --check` จะแสดงไฟล์ที่ยังเหลืออยู่

| ไฟล์ | ใส่อะไร |
| --- | --- |
| `.stack-agent/verify.json` | คำสั่งที่รันเทสของคุณ และ **check** หนึ่งตัวที่รันโปรแกรมจริงแบบที่ผู้ใช้ใช้ |
| `.stack-agent/guard.config.json` | แทนกฎตัวอย่างด้วยกฎจริงหนึ่งข้อที่ทีมไม่อยากให้ใครละเมิด |
| `.stack-agent/rules.md` | วิธีที่ทีมชอบ บรรทัดละข้อ พร้อมเหตุผล และเพิ่ม `@.stack-agent/rules.md` ใน `CLAUDE.md` ของ repo เพื่อให้ทุก session โหลด |
| `.stack-agent/rules-table.md` | หนึ่งบรรทัดต่อกฎเข้ม บอกว่ากฎนั้นมีไว้ทำไม |
| `.stack-agent/feature-map.md` | สิ่งที่ผู้ใช้ทำสักไม่กี่อย่าง และแต่ละอย่างอยู่ที่ไหนในโค้ด |
| `.github/workflows/stack-agent.yml` | ขั้นติดตั้ง dependency ของคุณ (`npm ci`, `pip install -r requirements.txt` ฯลฯ) และ branch ที่ควรรัน |

`verify.json` ที่เล็กที่สุดที่ใช้ได้ สำหรับโปรเจกต์ Node:

```json
{
  "test": { "command": "npm test", "timeoutSec": 600 },
  "evidenceDir": ".stack-agent/evidence",
  "checks": [
    {
      "name": "smoke",
      "command": "node -e \"import('./src/add.js').then(m => { if (m.add(2, 2) !== 4) process.exit(1) })\"",
      "expectExit": 0,
      "timeoutSec": 120
    }
  ]
}
```

กฎ guard คือ regex บนไฟล์ที่ระบุ พร้อมข้อความและวิธีแก้ที่ agent จะเห็น:

```json
{
  "id": "no-console-log",
  "type": "pattern",
  "files": ["src/**"],
  "pattern": "console\\.log\\(",
  "message": "use the logger, not console.log",
  "fix": "call log.info(...) from src/log.js"
}
```

ถ้ามี server, HTTP check, ฐานข้อมูล และขั้น `against` ดูหัวข้อ 1 ของ [docs/th/adoption.md](docs/th/adoption.md)

### 4. บันทึกสถานะวันนี้แล้วตรวจ

```bash
node .stack-agent/bin/guard.mjs --update-baseline
```

```bash
node .stack-agent/bin/verify.mjs
```

```bash
node path/to/Stack_Agent/scripts/init.mjs . --check
```

คำสั่งแรกบันทึกการละเมิดที่มีอยู่แล้ว จึงมีแต่ของใหม่ที่ fail คำสั่งที่สองควรจบด้วย `verify: ok` คำสั่งที่สามควรบอก `setup complete` ถ้ายังไม่ได้ มันจะแสดงสิ่งที่เหลือ ในโปรเจกต์ขนาดนี้หน้าตาเป็น:

```
PASS tests: npm test (exit 0)
PASS check smoke: node -e "..." -> exit 0
SKIP against: .stack-agent/verify.json does not exist at HEAD
verify: ok, evidence .stack-agent/evidence/verify-2026-10-27T08-58-08-216Z.json
```

(`SKIP` เป็นเรื่องปกติจนกว่าจะ commit config เพราะ `verify.json` ยังไม่อยู่ใน git จึงไม่มีรุ่นก่อนหน้าให้เทียบ)

### 5. Commit แล้วให้ CI เป็นด่าน

Commit `.stack-agent/` (โฟลเดอร์ evidence ถูก git-ignore) และ workflow จากนั้นบน GitHub ตั้งให้ job ของ workflow เป็น required check บน default branch และเพิ่ม `.github/CODEOWNERS` ด้วยบรรทัดอย่าง `/.stack-agent/ @your-org/leads` (และอีกบรรทัดสำหรับ workflow) เพื่อไม่ให้ผ่อนกฎได้โดยไม่มีผู้รีวิว `init` ไม่เขียนไฟล์นี้ให้เพราะไม่รู้จักทีมของคุณ job `verify` จะ fail จนกว่าจะกรอกขั้นติดตั้ง ซึ่งตั้งใจไว้อย่างนั้น เพื่อไม่ให้ pull request ปิดด่านด้วยการทิ้ง placeholder ไว้ [docs/th/adoption.md](docs/th/adoption.md) มีรายละเอียด รวมถึง monorepo

### 6. ดูว่ามันทำงาน

เปิด session ของ Claude Code **ใหม่** ในโปรเจกต์ (hook โหลดตอนเริ่ม session) แล้วลองสองอย่างที่สำคัญ:

1. สั่งให้ agent รัน `git commit --allow-empty --no-verify -m test` hook จะปฏิเสธด้วยข้อความ:

   ```
   blocked: `git commit --no-verify` skips the repo's guard and checks. Fix what the hook reports instead.
   ```

2. สั่งให้มันแก้โค้ดแล้วหยุด Stop hook จะบล็อกจนกว่า verify ที่ผ่านจะตรงกับโค้ด หรือ agent บันทึกเหตุผลที่ verify ไม่ได้

ถ้าไม่เกิดทั้งสองอย่าง ดูหัวข้อแก้ปัญหาด้านล่าง

### เข้าร่วมโปรเจกต์ที่ใช้อยู่แล้ว

ไม่ต้องตั้งค่าอะไรเลย `.stack-agent/` และ workflow ของ CI ถูก commit ไว้แล้ว พอ clone repository มา guard และ verify ก็ใช้ได้ทันที และ CI ก็บังคับใช้อยู่แล้ว สิ่งที่คุณเพิ่มคือปลั๊กอิน เพื่อให้ hook และ skill ทำงานใน session ของ Claude Code ของคุณเอง

1. ตรวจว่ามีปลั๊กอินแล้วหรือยังด้วย `claude plugin list` ถ้ายังไม่มี ติดตั้งด้วยสองคำสั่งจากขั้นที่ 1 (โปรเจกต์ที่ตั้งค่าแบบ `--scope project` จะมีปลั๊กอินระบุไว้ใน `.claude/settings.json` ด้วย แต่นั่นไม่ได้ติดตั้งให้คุณ)
2. ติดตั้ง dependency ของโปรเจกต์ตามที่ README ของโปรเจกต์บอก แล้วรัน guard และ verify ทั้งสองควรผ่านก่อนที่คุณจะแก้อะไร ส่วน guard ไม่ต้องติดตั้งอะไรเลย

   ```bash
   node .stack-agent/bin/guard.mjs
   ```

   ```bash
   node .stack-agent/bin/verify.mjs
   ```

3. เปิด Claude Code ในโปรเจกต์ ถ้าปลั๊กอินใหม่กว่าเครื่องมือใน `.stack-agent/bin/` SessionStart hook จะบอกและพิมพ์คำสั่งที่อัปเดตให้ คำสั่งนั้นแก้ไฟล์ที่ commit อยู่ จึงควรรันเมื่อทีมเห็นด้วย และ commit ผลลัพธ์แยกต่างหาก
4. ทำงานตามปกติ hook จะถามคนก่อนแก้ config ของ guard, baseline หรือ workflow และ CI จะ fail pull request ที่ผ่อนสิ่งเหล่านี้ การเปลี่ยนกฎจึงผ่านการรีวิวเสมอ

### อัปเดตและถอนการติดตั้ง

```bash
claude plugin update stack-agent@stack-agent-marketplace
```

เปิด Claude Code ใหม่ ถ้าเครื่องมือของ plugin ใหม่กว่าสำเนาใน `.stack-agent/bin/` SessionStart hook จะบอกและพิมพ์คำสั่งที่ต้องรันให้ ซึ่งคือคำสั่ง `init.mjs` จากขั้นที่ 2 มันเขียนทับเฉพาะเครื่องมือ ไม่แตะ config ของคุณ Commit ผลลัพธ์เพื่อให้ CI รันเครื่องมือชุดเดียวกับ hook

ถ้าจะถอน: `claude plugin uninstall stack-agent@stack-agent-marketplace` แล้วลบ `.stack-agent/`, workflow, บรรทัด `@.stack-agent/rules.md` ใน `CLAUDE.md` และบรรทัด `.stack-agent/` ที่ `init` เพิ่มใน `.gitignore` กับ `.prettierignore`

### หรือ fork ไปแก้เอง

Fork หรือ clone repo แล้วแก้ได้ทุกอย่าง เพิ่ม preset, guard rule, skill หรือ eval case ให้ทีมใช้ fork ของคุณด้วย `claude plugin marketplace add <you>/<your-fork>` ดู [docs/th/customizing.md](docs/th/customizing.md)

## ใช้ประจำวัน

1. agent แก้โค้ด hook รัน guard ทุกครั้งที่แก้ไฟล์ และกับไฟล์ที่คำสั่ง shell เปลี่ยน แล้วรายงานสิ่งที่ละเมิดพร้อมวิธีแก้
2. ก่อนจบงาน agent รัน `node .stack-agent/bin/verify.mjs` และรายงานไฟล์หลักฐาน ถ้ามันจะหยุดทั้งที่ไม่มีหลักฐานที่ตรงกับโค้ด Stop hook จะบล็อก สูงสุด 3 ครั้งติดกัน แล้วปล่อยให้หยุดพร้อมบอกคุณว่าการเปลี่ยนนี้ยังไม่ได้ verify
3. CI รัน guard (พร้อม `--compare-ref` บน pull request), การเช็ก API map หรือ feature map ถ้าโปรเจกต์มี และ verify ทุก push และ pull request (พร้อมขั้น against บน pull request)
4. เมื่อคุณต้องแก้ agent เรื่องเดิมสองครั้ง ให้รัน `/stack-agent:correct` เพื่อเปลี่ยนเป็นกฎ
5. สุ่มตรวจ commit ล่าสุดด้วย `/stack-agent:sample-review` แทนการรีวิวทุก PR ก่อน

คำสั่งที่ใช้บ่อย (รันจาก root ของโปรเจกต์):

| ต้องการ | รัน |
| --- | --- |
| รันทุกอย่างและเขียนหลักฐาน | `node .stack-agent/bin/verify.mjs` |
| รัน check เดียว หรือรันแค่เทส | `node .stack-agent/bin/verify.mjs --check NAME` · `--skip-checks` |
| ดูว่า check ที่ไม่นิ่ง fail บ่อยแค่ไหน | `node .stack-agent/bin/verify.mjs --check NAME --repeat 30` |
| บอกเหตุผลที่ verify รันไม่ได้ (15 ตัวอักษรขึ้นไป) | `node .stack-agent/bin/verify.mjs --skip "no database in this sandbox"` |
| ตรวจกฎ | `node .stack-agent/bin/guard.mjs` |
| ยอมรับการละเมิดวันนี้เป็น baseline | `node .stack-agent/bin/guard.mjs --update-baseline` (คนเพิ่ม `--allow-increase` เมื่อจะเพิ่ม) |
| ให้ fail ถ้ากฎถูกผ่อนเมื่อเทียบกับ branch | `node .stack-agent/bin/guard.mjs --compare-ref origin/main` |
| ดูว่าการตั้งค่ายังเหลืออะไร | `node path/to/Stack_Agent/scripts/init.mjs . --check` |

ขั้นตอนทั้งหมดพร้อมทุกตัวเลือกอยู่ใน [docs/th/adoption.md](docs/th/adoption.md)

## แก้ปัญหา

- **hook ไม่ทำอะไรเลย** ตรวจว่า plugin เปิดอยู่ (`claude plugin list`) ว่าเปิด session ใหม่หลังติดตั้ง และว่าโปรเจกต์มี `.stack-agent/verify.json` hook จะไม่ยุ่งกับโปรเจกต์ที่ไม่มีไฟล์นี้
- **Stop hook บล็อกไม่เลิก** รัน `node .stack-agent/bin/verify.mjs` หรือถ้า verify รันไม่ได้จริงๆ ให้บันทึกเหตุผลด้วย `--skip "<เหตุผล>"` หลังบล็อก 3 ครั้งติดกัน มันจะปล่อยให้ agent หยุดและบอกว่ายังไม่ได้ verify ข้อความใหม่จากคุณจะรีเซ็ตตัวนับ
- **`guard --update-baseline` ไม่ยอมทำ** มันจะไม่เพิ่ม baseline เอง เพราะกฎที่เพิ่งเพิ่มไปเจอการละเมิดเก่า หรือมีของใหม่เกิดขึ้น ถ้ายอมรับของเก่าได้ ให้คนรันซ้ำด้วย `--allow-increase`
- **`init --check` exit 1** อ่านรายการที่มันพิมพ์: placeholder ที่ต้องกรอก baseline ที่ยังไม่มี หรือเครื่องมือใน `.stack-agent/bin/` ที่เก่ากว่าของ plugin (รัน `init` ซ้ำเพื่ออัปเดต)
- **job `verify` ใน CI fail เพราะ `EDIT ME`** กรอกขั้นติดตั้งใน workflow มัน fail ตั้งใจจนกว่าจะกรอก
- **`verify` บอก `FAIL against`** check ใหม่ผ่านบนโค้ดเก่าด้วย จึงไม่ได้ทดสอบการเปลี่ยนนี้ เพิ่ม check ที่ fail เมื่อไม่มีการเปลี่ยนนั้น
- **formatter หรือ linter fail ที่ `.stack-agent/`** เพิ่มโฟลเดอร์ลงไฟล์ ignore ของมัน (`init` ทำให้สำหรับ Prettier และสำหรับ `.eslintignore` ที่มีอยู่แล้ว) เครื่องมือถูกคัดลอกแบบ byte ต่อ byte และตัวที่ถูกจัดรูปแบบใหม่จะอ่านว่าล้าสมัย

## มีอะไรบ้าง

| ชั้น | อยู่ที่ | หน้าที่ |
| --- | --- | --- |
| Verification | `scripts/verify.mjs`, skill `verify` | รันเทส เปิด server (ถ้ามี) รัน HTTP check และ command check แล้วเขียนหลักฐานลง `.stack-agent/evidence/` |
| Hard constraint (CI) | `scripts/guard.mjs` | กฎแบบ regex ใช้ได้ทุกภาษา และกฎ import สำหรับ JS/TS และ Python มี baseline แบบ ratchet คือของเดิมผ่าน แต่ของใหม่ต้อง fail ส่วน `--compare-ref` ทำให้ PR ที่แอบผ่อนกฎ fail |
| Hard constraint (ตอนทำงาน) | `hooks/hooks.json` | ในโปรเจกต์ที่ติดตั้ง Stack Agent แล้ว บล็อกการปิด git hook (`--no-verify`, `HUSKY=0`, `core.hooksPath`) และถามคนก่อน force-push, ลบหรือบังคับย้าย branch, `reset --hard` หรือแก้ไฟล์ของ guard เอง รัน guard หลังแก้ไฟล์ทุกครั้งและกับไฟล์ที่คำสั่ง shell แต่ละครั้งเปลี่ยน และไม่ให้ agent จบงานจนกว่าหลักฐานของ verify จะตรงกับโค้ดที่แก้ หรือ agent บันทึกเหตุผลว่าทำไม verify ไม่ได้ |
| Soft constraint | `.stack-agent/rules.md` | วิธีเขียนที่ทีมชอบ โหลดเข้าทุก session |
| Feature map (backend) | `scripts/api-map.mjs`, skill `api-map` | ร่างแผนที่ endpoint จากโค้ด และ fail เมื่อแผนที่ไม่ตรงกับโค้ด |
| Feature map (preset อื่น) | `scripts/feature-map.mjs`, skill `feature-map` | ตารางของสิ่งที่ผู้ใช้ทำและตำแหน่งในโค้ด (`path`, `path:line` หรือ `path#text`) fail เมื่อไฟล์ บรรทัด ข้อความ anchor หรือ verify check ที่อ้างถึงหายไป |
| Skills | `skills/` | `verify`, `stack-agent-init`, `correct`, `reflect`, `sample-review`, `debug`, `run-evals`, `feature-map`, `mine-corrections` และสำหรับ backend มี `add-endpoint`, `add-migration`, `api-map` |
| Agents | `agents/` | `judge` ให้คะแนนตาม rubric ส่วน `reviewer` ตรวจ diff ก่อนส่งให้คนและรายงานเป็น candidate แล้ว `finding-verifier` พยายามหักล้างทีละข้อ ทุกตัวห้ามแก้ไฟล์ |
| Evals | `evals/` | case สำหรับ `claude plugin eval` ที่เทียบผลแบบมีและไม่มี plugin |

## Preset

| Preset | สำหรับ | verify ใช้อะไร |
| --- | --- | --- |
| `generic` | อะไรก็ได้ (ค่าเริ่มต้น) | คำสั่งรันเทส และคำสั่ง smoke หนึ่งตัว |
| `backend-http` | API และ web server | server, HTTP check และแผนที่ API |
| `frontend-web` | web app | dev server, การเช็กหน้าเว็บ และคำสั่ง e2e |
| `cli` | เครื่องมือ command line | command check สำหรับ `--help`, การใช้งานหลัก และ input ที่ผิด |
| `library` | package ที่คนอื่น import | build และตัวอย่างที่เรียกใช้ public API |

ทุก preset มีกฎ guard สากล 2 ข้อ คือห้าม commit เครื่องหมาย merge conflict และห้ามมี private key ใน repo

## ตัวอย่าง

- [`examples/sample-backend`](examples/sample-backend): HTTP API ด้วย Node บน `node:sqlite` มีโมดูล ตัวรัน migration แผนที่ API และการละเมิดเก่าที่ตั้งใจใส่ไว้เพื่อโชว์ ratchet
- [`examples/sample-cli`](examples/sample-cli): CLI ด้วย Python มี command check และกฎ guard "core ต้องบริสุทธิ์" แสดงว่าตัวโปรเจกต์ไม่จำเป็นต้องเป็น Node
- [`examples/sample-library`](examples/sample-library) (preset `library`): package Node เล็กๆ ที่ check `build` โหลด `dist/` ผ่าน `exports` ใน `package.json` และตัวอย่าง import package ด้วยชื่อ พร้อมกฎ guard ที่กันไม่ให้ตัวอย่างแตะ `src/internal/`
- [`examples/sample-frontend`](examples/sample-frontend) (preset `frontend-web`): web app แบบ static บน dev server ที่ใช้ `node:http` มีการเช็กหน้าเว็บและสคริปต์ `e2e` ที่ตามทุกโมดูลที่หน้าเว็บโหลด พร้อมกฎ guard `client-not-import-server`
- [`examples/sample-generic`](examples/sample-generic) (preset `generic`): งานข้อมูลที่แปลง CSV ค่าใช้จ่ายเป็นยอดรวมต่อหมวด มี smoke check แบบ `args` ที่ไม่ผ่าน shell และกฎ guard "transform ต้องบริสุทธิ์"

## ข้อกำหนดและข้อจำกัด

- Node.js 22 ขึ้นไป ใช้รันเครื่องมือเท่านั้น โปรเจกต์ใช้ภาษาอะไรก็ได้
- กฎ `forbidden-import` และ `module-boundary` อ่าน import ของ JS/TS และ Python ภาษาอื่นใช้กฎ `pattern`
- hook จับ pattern ของคำสั่ง ดักทางลัดที่พบบ่อยได้ ไม่ใช่ทุกทางที่เป็นไปได้ CI คือด่านที่กันได้เสมอ
- `claude plugin eval` ต้องใช้ Claude Code 2.1.269 ขึ้นไป case ที่ให้ agent ใช้ Bash ต้องใช้ Linux, macOS หรือ WSL2 เพราะ Windows แบบ native ไม่มี sandbox ให้
- ทดสอบบน Windows 11 กับ Node 26 CI รันเทสและตัวอย่างทั้งห้าบน Linux และ Windows กับ Node 22 และ 24
- hook ถูกรันจริงกับ Claude Code 2.1.299 ถึง 2.1.310 Claude Code เปลี่ยนบ่อย จึงมี workflow รายสัปดาห์ใน repo นี้ (`scripts/canary.mjs`) ที่รันปลั๊กอินกับรุ่นล่าสุดเพื่อจับความเสียหายแต่เนิ่นๆ ถ้า hook เลิกทำงานหลังอัปเดต [เปิด issue](https://github.com/Brown248/Stack_Agent/issues)

## พัฒนา Stack Agent

```bash
npm test
```

```bash
claude plugin validate . --strict
```

กติกาสำหรับการทำงานกับ repo นี้อยู่ใน [.claude/CLAUDE.md](.claude/CLAUDE.md)

## สัญญาอนุญาต

[MIT](LICENSE)
