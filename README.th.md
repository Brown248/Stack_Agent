# Stack Agent

Claude Code plugin และ template ที่เปลี่ยนความรู้ของทีมให้กลายเป็นโครงสร้างที่ AI agent ข้ามไม่ได้ ได้แก่ verification ที่มีหลักฐาน, guard rule แบบ ratchet, hook ที่ดักทางลัด, skill เล็กที่มี script, judge ที่ตรวจแบบไม่รู้ว่าใครทำ และ eval ที่วัดว่าทั้งหมดนี้ช่วยได้จริงหรือไม่

ใช้ได้กับโปรเจคทุกประเภท มี preset สำหรับ HTTP backend, web frontend, CLI และ library ส่วนแกนกลางใช้ได้กับทุกอย่างที่ทดสอบได้ด้วยคำสั่ง จะติดตั้งเป็น plugin หรือ fork ไปแก้เป็นของตัวเองก็ได้

[English](README.md)

## ทำไมต้องมี

AI agent เขียนโค้ดได้เร็ว แต่มีสามเรื่องที่ทำให้เรายังต้องนั่งเฝ้าทุกบรรทัด:

- บอกว่า "น่าจะใช้ได้" ทั้งที่ยังไม่ได้รันอะไรเลย
- เลือกทางลัดที่สั้นที่สุดที่ compile ผ่าน จนโครงสร้างค่อยๆ เละ
- ผิดเรื่องเดิมซ้ำ เพราะกฎที่อยู่ใน prompt ลืมได้ง่าย

Stack Agent ย้ายกฎออกจาก prompt ไปไว้ในสิ่งที่ fail ให้เห็นชัด คือ verify ที่ต้องรันผ่าน, guard ที่ทำให้ CI แดง และ hook ที่หยุด agent ทันทีที่มันจะใช้ทางลัด แนวคิดมาจากทอล์กของ Lauren Tan เรื่อง pstack และวิธีที่วิศวกร Anthropic สร้าง skill ใน Claude Code ดูที่มาได้ใน [docs/th/design-notes.md](docs/th/design-notes.md)

## มีอะไรบ้าง

| ชั้น | อยู่ที่ | หน้าที่ |
| --- | --- | --- |
| Verification | `scripts/verify.mjs`, skill `verify` | รันเทส เปิด server (ถ้ามี) รัน HTTP check และ command check แล้วเขียนหลักฐานลง `.stack-agent/evidence/` |
| Hard constraint (CI) | `scripts/guard.mjs` | กฎแบบ regex ใช้ได้ทุกภาษา และกฎ import สำหรับ JS/TS และ Python มี baseline แบบ ratchet คือของเดิมผ่าน แต่ของใหม่ต้อง fail ส่วน `--compare-ref` ทำให้ PR ที่แอบผ่อนกฎ fail |
| Hard constraint (ตอนทำงาน) | `hooks/hooks.json` | บล็อกการปิด git hook (`--no-verify`, `HUSKY=0`, `core.hooksPath`) และถามคนก่อน force-push, ลบ branch, `reset --hard` หรือแก้ไฟล์ของ guard เอง รัน guard หลังแก้ไฟล์ทุกครั้ง และเตือนครั้งเดียวก่อน agent จบงานถ้ายังไม่ได้ verify |
| Soft constraint | `.stack-agent/rules.md` | วิธีเขียนที่ทีมชอบ โหลดเข้าทุก session |
| Feature map (backend) | `scripts/api-map.mjs`, skill `api-map` | ร่างแผนที่ endpoint จากโค้ด และ fail เมื่อแผนที่ไม่ตรงกับโค้ด |
| Skills | `skills/` | `verify`, `stack-agent-init`, `correct`, `reflect`, `sample-review`, `debug`, `run-evals` และสำหรับ backend มี `add-endpoint`, `add-migration`, `api-map` |
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

## เริ่มใช้

### ใช้แบบ plugin

```bash
claude plugin marketplace add Brown248/Stack_Agent
```

```bash
claude plugin install stack-agent@stack-agent-marketplace
```

จากนั้นใน Claude Code ที่เปิดอยู่ในโปรเจคของคุณ พิมพ์ `/stack-agent:stack-agent-init` skill จะช่วยเลือก preset, กรอก config และรันแต่ละ check จนผ่าน

หรือตั้งค่าเองจาก repo ที่ clone มา:

```bash
node path/to/Stack_Agent/scripts/init.mjs . --preset cli
```

`init.mjs` คัดลอกเครื่องมือไปไว้ใน `.stack-agent/bin/` เพื่อให้ CI รันได้โดยไม่ต้องมี plugin และเพิ่ม template config กับ workflow ของ GitHub Actions เฉพาะไฟล์ที่ยังไม่มี รันซ้ำได้ปลอดภัย ใช้ `--check` เพื่อดูว่ายังเหลืออะไรที่ต้องตั้งค่า

### Fork ไปแก้เอง

Fork หรือ clone repo แล้วแก้ได้ทุกส่วน เช่นเพิ่ม preset, กฎ guard, skill หรือ eval case แล้วให้ทีมติดตั้งจาก fork ของคุณด้วย `claude plugin marketplace add <you>/<your-fork>` ดูรายละเอียดใน [docs/th/customizing.md](docs/th/customizing.md)

## การใช้งานประจำวัน

1. Agent แก้โค้ด hook จะรัน guard ทุกครั้งที่แก้ไฟล์ และบอกวิธีแก้เมื่อเจอการละเมิดกฎ
2. ก่อนจบงาน agent รัน `node .stack-agent/bin/verify.mjs` แล้วรายงานไฟล์หลักฐาน ถ้าพยายามจบโดยไม่มีหลักฐาน Stop hook จะเตือนหนึ่งครั้ง
3. CI รัน guard และ `--compare-ref` ทุก pull request และรันการตรวจแผนที่ API ในโปรเจคที่มีแผนที่
4. เมื่อต้องแก้ agent เรื่องเดิมซ้ำสองครั้ง ให้ใช้ `/stack-agent:correct` เปลี่ยนเรื่องนั้นเป็นกฎ
5. สุ่มตรวจ commit ล่าสุดด้วย `/stack-agent:sample-review` แทนการรีวิวทุก PR ก่อน merge

ขั้นตอนตั้งค่าแบบละเอียดอยู่ใน [docs/th/adoption.md](docs/th/adoption.md)

## ตัวอย่าง

- [`examples/sample-backend`](examples/sample-backend): HTTP API ด้วย Node บน `node:sqlite` แบ่งเป็นโมดูล มีตัวรัน migration, แผนที่ API และจุดผิดกฎแบบ legacy ที่ตั้งใจใส่ไว้เพื่อสาธิต ratchet
- [`examples/sample-cli`](examples/sample-cli): CLI ภาษา Python ที่มี command check และกฎ guard "core ต้องไม่ทำ I/O" แสดงว่าตัวโปรเจคไม่จำเป็นต้องเป็น Node
- [`examples/sample-library`](examples/sample-library) (preset `library`): แพ็กเกจ Node ขนาดเล็กที่ check `build` โหลด `dist/` ผ่าน `exports` ใน `package.json` และตัวอย่าง import แพ็กเกจด้วยชื่อแบบที่ผู้ใช้จริงทำ พร้อมกฎ guard ที่ห้ามตัวอย่างเข้าไปใช้ `src/internal/`
- [`examples/sample-frontend`](examples/sample-frontend) (preset `frontend-web`): เว็บแอปแบบ static บน dev server ที่เขียนด้วย `node:http` มี check หน้าเว็บ และสคริปต์ `e2e` ที่ไล่ตรวจทุกโมดูลที่หน้าเว็บโหลด พร้อมกฎ guard `client-not-import-server`
- [`examples/sample-generic`](examples/sample-generic) (preset `generic`): งานประมวลผลข้อมูลที่แปลง CSV ค่าใช้จ่ายเป็นยอดรวมแยกตามหมวด มี smoke check แบบ `args` ที่ไม่ผ่าน shell และกฎ guard "transform ต้องไม่ทำ I/O"

## ข้อกำหนดและข้อจำกัด

- ต้องมี Node.js 22 ขึ้นไปเพื่อรันเครื่องมือเท่านั้น ตัวโปรเจคใช้ภาษาอะไรก็ได้
- กฎ `forbidden-import` และ `module-boundary` อ่าน import ของ JS/TS และ Python ภาษาอื่นให้ใช้กฎแบบ `pattern`
- hook ดักด้วยการจับ pattern ของคำสั่ง จึงจับทางลัดที่พบบ่อยได้ แต่ไม่ครอบคลุมทุกรูปแบบ CI คือด่านที่ต้องมีเสมอ
- `claude plugin eval` ต้องใช้ Claude Code 2.1.269 ขึ้นไป eval case ที่ให้ agent ใช้ Bash ต้องรันบน Linux, macOS หรือ WSL2 เพราะ Windows ไม่มี sandbox สำหรับกรณีนี้
- ทดสอบจริงแล้วบน Windows 11 กับ Node 25 ส่วน CI ตั้งไว้สำหรับ Linux และ Windows บน Node 22 และ 24

## พัฒนา Stack Agent

```bash
npm test
```

```bash
claude plugin validate . --strict
```

กติกาสำหรับการแก้ repo นี้อยู่ใน [.claude/CLAUDE.md](.claude/CLAUDE.md)

## License

[MIT](LICENSE)
