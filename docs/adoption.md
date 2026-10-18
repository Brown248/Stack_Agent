# นำ Stack Agent ไปใช้กับ backend repo

ทำตามลำดับ แต่ละขั้นจบด้วยคำสั่งที่ต้องผ่าน ไม่ใช่แค่บอกว่าทำแล้ว ลำดับนี้มาจากสรุปข้อ "ลำดับที่ควรทำ"

## 0. ติดตั้ง

ติดตั้ง plugin (ดู README) แล้วรันใน root ของ backend repo:

```bash
node <path-to-Stack_Agent>/scripts/init.mjs .
```

หรือพิมพ์ `/stack-agent:stack-agent-init` ใน Claude Code ให้มันทำทุกขั้นด้านล่างให้

## 1. Verification

แก้ `.stack-agent/verify.json`:

- `test.command`: คำสั่งรันเทสจริงของ repo
- `server.command`, `server.env`, `server.readyUrl`: วิธีเปิด API ในเครื่อง และ URL ที่ตอบเมื่อพร้อม
- `checks[]`: endpoint ที่ยิงได้โดยไม่ต้องพึ่งระบบภายนอก ทั้งกรณีสำเร็จและกรณีถูกปฏิเสธ

```bash
node .stack-agent/bin/verify.mjs
```

ต้องได้ `verify: ok` ถ้า server ต้องใช้ secret หรือ DB ภายนอก ให้หาวิธีรันในเครื่อง (docker compose, ฐานข้อมูลทดสอบ) ก่อน ถ้ายังทำไม่ได้ให้บันทึกไว้ อย่าข้ามด้วยการปลอม check

verify จะไม่ยุ่งกับ server ที่ไม่ได้เปิดเอง ถ้าพอร์ตมีคนใช้อยู่จะหยุดและบอก (`--reuse` ใช้เมื่อตั้งใจยิง server ที่เปิดอยู่แล้ว) process ที่ verify เปิดเอง (เทสที่เกินเวลา และ server) จะถูกปิดทั้ง process tree เมื่อจบ

`baseUrl` มี path prefix ได้ เช่น `http://127.0.0.1:3999/api/v1` แล้ว check ใช้ `"path": "/items"`

หลักฐานที่นับว่าเสร็จคือการรันแบบเต็มโดยไม่ใส่ flag (`latest.json` มี `"full": true`) การรันที่ใส่ `--skip-tests`, `--skip-checks`, `--check` หรือ `--reuse` ใช้ระหว่างแก้ได้ แต่ Stop hook จะไม่นับเป็นหลักฐาน

## 2. Guard

ใส่กฎห้ามพลาด 3–5 ข้อใน `.stack-agent/guard.config.json` ทุกข้อต้องมี `message` และ `fix` ที่บอกว่าให้ใช้อะไรแทน กฎที่ไม่ตรงกับโครงสร้าง repo (เช่น template มี `module-boundary` ที่ `src/modules` แต่ repo ไม่มีโฟลเดอร์นี้) ให้แก้หรือลบ guard จะเตือน `rule ... matches no files` ให้เห็น

| type | ใช้เมื่อ | ฟิลด์ |
| --- | --- | --- |
| `pattern` | ห้ามข้อความ/โค้ดรูปแบบหนึ่งในไฟล์กลุ่มหนึ่ง เช่น SQL ใน controller | `files`, `pattern`, `flags`, `exclude` |
| `forbidden-import` | ห้ามไฟล์กลุ่มหนึ่ง import อีกกลุ่ม หรือ package หนึ่ง | `files`, `to` (glob ของไฟล์ปลายทางใน repo), `toSpecifiers` (glob ของชื่อ package) |
| `module-boundary` | โมดูลคุยกันผ่าน public entry เท่านั้น | `modulesRoot`, `publicEntry` |

ข้อควรรู้:

- `files`, `exclude`, `to`, `toSpecifiers`, `publicEntry`, `ignore` ต้องเป็น **array ของ string** ถ้าใส่เป็น string เดี่ยว guard จะแจ้ง config error
- `to` เทียบกับ path ของไฟล์ที่ import ไปถึงจริง ไม่ใช่ข้อความใน import เช่น import `../db/index.js` ต้องเขียน `"to": ["src/db/**"]` ถ้าเขียน `"src/db"` จะไม่จับอะไรเลย
- glob รองรับ `*`, `**`, `?` และ `{js,ts}`
- import แบบ path alias (เช่น `@/modules/x`) ต้องบอก guard ผ่าน `"aliases": {"@/": "src/"}` ไม่อย่างนั้นกฎ import จะมองไม่เห็น
- กฎ import อ่านเฉพาะ JS/TS (`import`, `export ... from`, `require()`, `import()`) และข้าม import ที่อยู่ใน comment

```bash
node .stack-agent/bin/guard.mjs --update-baseline
node .stack-agent/bin/guard.mjs
```

คำสั่งแรกบันทึกของเก่าลง `guard-baseline.json` (ratchet) ต่อจากนั้นจะ fail เฉพาะเมื่อไฟล์ใดมี violation เพิ่มขึ้น ข้อจำกัดของ ratchet: นับ **ต่อไฟล์ต่อกฎ** ถ้าในไฟล์เดียวกันแก้ของเก่าหนึ่งจุดแล้วเพิ่มของใหม่หนึ่งจุด จำนวนเท่าเดิมจึงผ่าน และถ้าเปลี่ยนชื่อไฟล์ ค่าใน baseline ของชื่อเก่าจะไม่ตามไปด้วย

การลด baseline ทำได้เสมอ (`--update-baseline` เมื่อของเก่าถูกแก้แล้ว) แต่ถ้าคำสั่งนี้เจอว่าจำนวนใดเพิ่มขึ้น มันจะไม่เขียนให้และ exit 1 ต้องเพิ่ม `--allow-increase` ซึ่ง hook จะถามคนก่อนทุกครั้ง ยกเว้นตอนสร้าง baseline ครั้งแรกที่ยังไม่มีไฟล์

ข้อยกเว้นรายบรรทัดต้องมีเหตุผล วันหมดอายุ และคนอนุมัติ:

```js
// stack-agent-allow no-sql-in-controller reason="export report, ticket 42" until=2026-12-31 by=lead
```

- comment ที่อยู่บรรทัดของตัวเองใช้กับบรรทัดถัดไป ถ้าต่อท้ายโค้ดใช้กับบรรทัดนั้นบรรทัดเดียว
- วันหมดอายุต้องไม่เกิน `maxAllowDays` (ค่าเริ่มต้น 90 วัน ตั้งได้ใน config) ชื่อกฎต้องมีอยู่จริง และวันที่ต้องเป็นวันจริง
- พอเลยวันหมดอายุ guard จะ fail อีกครั้ง
- guard ตรวจไม่ได้ว่า `by=` เป็นคนอนุมัติจริง ส่วนนี้ต้องพึ่งการรีวิว PR (ดูหัวข้อ "ป้องกันไม่ให้ guard ถูกปิดเอง")

CI: `.github/workflows/stack-agent.yml` รัน guard, รัน `guard.mjs --compare-ref origin/<base>` ใน PR (fail ถ้า baseline โตขึ้น หรือกฎถูกลบหรือแคบลงเมื่อเทียบกับ branch หลัก) และรัน api-map ถ้าไม่ได้ใช้ GitHub Actions ให้ใส่คำสั่งเหล่านี้ใน CI ที่ใช้อยู่

### ป้องกันไม่ให้ guard ถูกปิดเอง

ทางที่ AI จะเลี่ยงกฎได้ง่ายที่สุดคือแก้ไฟล์ของ guard เอง ระบบมีกันไว้สามชั้น:

1. **ตอนทำงาน:** hook ถามคนก่อนเมื่อ Edit/Write หรือคำสั่ง shell (Bash หรือ PowerShell) จะแก้ `guard.config.json`, `guard-baseline.json`, `.stack-agent/bin/` หรือ `stack-agent.yml`
2. **ใน CI:** `--compare-ref` fail เมื่อ baseline โตหรือกฎถูกลบหรือแคบลง
3. **ในการรีวิว:** เพิ่มไฟล์ `.github/CODEOWNERS` ให้คนที่รับผิดชอบต้องอนุมัติทุกการแก้ใน `.stack-agent/` เช่น `/.stack-agent/ @your-team/leads` (init ไม่ได้สร้างให้ เพราะไม่รู้ชื่อทีม)

ข้อจำกัดที่ยังมี: hook PostToolUse ตรวจเฉพาะไฟล์ที่แก้ผ่าน Edit/Write ถ้าแก้โค้ดผ่านคำสั่ง shell (เช่น `sed -i`) จะไม่ถูกตรวจทันที แต่ CI และ Stop hook ยังจับได้ ส่วน hook ที่ดักคำสั่ง shell เป็นการอ่าน pattern จึงไม่ครอบคลุมทุกรูปแบบที่เป็นไปได้ CI คือด่านสุดท้ายที่ต้องมีเสมอ

## 3. แผนที่ API

ตั้ง `sources` ใน `.stack-agent/api-map.json` เป็น regex ที่จับ route ได้ (กลุ่มที่ 1 = method, กลุ่มที่ 2 = path) ตัวอย่างสำหรับ Express: `router\.(get|post|put|patch|delete)\(\s*['"]([^'"]+)`

```bash
node .stack-agent/bin/api-map.mjs --draft > .stack-agent/api-map.md
node .stack-agent/bin/api-map.mjs
```

`--draft` ใส่คอลัมน์ Handler เป็นไฟล์และบรรทัดที่ประกาศ route ไว้ให้ ให้ AI เปลี่ยนเป็นไฟล์ handler จริง แล้วเติม Calls / Owner จากโค้ด แถวที่ไม่แน่ใจให้คงคำว่า `TODO` ไว้ให้คนตรวจ

คำสั่งที่สอง:

- **fail (exit 1)** เมื่อแผนที่กับโค้ดไม่ตรงกัน: route ในโค้ดไม่มีในแผนที่, แถวในแผนที่ไม่มี route, path ของ handler ไม่มีอยู่จริง
- **เตือนแต่ไม่ fail** เมื่อ endpoint ยังไม่มี verify check หรือแถวยังมี `TODO`

แผนที่ต้องเป็นตาราง markdown ที่คอลัมน์แรกเป็น HTTP method และคอลัมน์ที่สองเป็น path ตรงกับที่ regex จับได้ ถ้า route ถูก mount ใต้ prefix (เช่น `app.use("/items", router)`) regex จะเห็นแค่ path ส่วนท้าย ให้เขียนแผนที่ตามที่ regex จับได้ หรือเขียน regex ให้รวม prefix

## 3.5 กฎของทีม และตรวจว่าตั้งค่าครบ

- เติม `.stack-agent/rules.md` (soft constraint: วิธีเขียนที่ทีมชอบ) แล้วเพิ่ม `@.stack-agent/rules.md` ใน `CLAUDE.md` ของ repo ให้ทุก session โหลด
- เติม `.stack-agent/rules-table.md` ให้ทุกกฎที่ห้ามพลาดมีแถว: กฎ, เหตุผล, อะไรบังคับมัน, หลักฐานว่าจับความผิดจริงได้

```bash
node <path-to-Stack_Agent>/scripts/init.mjs . --check
```

exit 0 แปลว่าตั้งค่าครบ ถ้ายังมี `EDIT ME` หรือไฟล์ขาดจะ exit 1 พร้อมบอกว่าเหลืออะไร

## 4. Skills

- ใช้ `add-endpoint` และ `add-migration` ที่มีให้
- เพิ่ม skill ของงานที่ทีมทำบ่อยที่สุด 2–3 อย่าง: ทำเป็นโฟลเดอร์ใน `.claude/skills/<name>/SKILL.md` ของ repo ถ้ามีโค้ดที่ AI ต้องเขียนซ้ำทุกครั้ง ให้เก็บเป็น script ไว้ในโฟลเดอร์ของ skill
- จบงานใหญ่แล้วใช้ `/stack-agent:reflect` เพื่อเก็บบทเรียนลง skill (ต้องอนุมัติก่อนแก้)
- โดนแก้เรื่องเดิมซ้ำ ให้ใช้ `/stack-agent:correct` เปลี่ยนเป็นกฎ guard พร้อมพิสูจน์ว่ากฎจับความผิดจริงได้

## 5. Evals

ทำเมื่อมี skill ให้วัดแล้ว ดู `/stack-agent:run-evals` ควรมีอย่างน้อย 1 case ต่อ skill และดูค่า Δ (มี plugin เทียบกับไม่มี) ไม่ใช่แค่คะแนน

## ยังไม่ทำ

auto-merge และ outer loop ยังไม่ทำ เพราะ repo มีทีมอื่นใช้ร่วมด้วย ให้ AI ทำแล้วคนรีวิว (ใช้ agent `reviewer` ช่วยตรวจก่อนส่งคน)
