# นำ Stack Agent ไปใช้ในโปรเจคของคุณ

ทำตามลำดับ แต่ละขั้นจบด้วยคำสั่งที่ต้องรันผ่าน ไม่ใช่แค่บอกว่าทำแล้ว ลำดับนี้มาจากหลักข้อเดียว คือถ้า agent ตรวจงานตัวเองไม่ได้ อย่างอื่นก็ไว้ใจไม่ได้

[English](../adoption.md)

## 0. ติดตั้ง

ติดตั้ง plugin (ดู [README](../../README.th.md)) แล้วพิมพ์ `/stack-agent:stack-agent-init` ใน Claude Code ที่เปิดอยู่ในโปรเจค skill จะพาทำทุกขั้นด้านล่างให้ ถ้าจะทำเอง:

```bash
node <path-to-Stack_Agent>/scripts/init.mjs . --preset <preset>
```

preset ที่มี: `generic` (ค่าเริ่มต้น), `backend-http`, `frontend-web`, `cli`, `library` ดูรายชื่อได้ด้วย `node <path-to-Stack_Agent>/scripts/init.mjs --list-presets` ให้เลือกตามส่วนที่ผู้ใช้แตะเป็นอันดับแรก `verify.json` ไฟล์เดียวมีได้ทั้ง HTTP check และ command check

`init` บันทึก preset ไว้ใน `.stack-agent/preset` และใช้ค่านั้นในการรันครั้งต่อไป ถ้าสั่ง preset อื่นจะไม่ยอม เพราะจะได้ config ของ preset เดิมปนกับไฟล์ของ preset ใหม่ ถ้าจะเปลี่ยน ให้ลบ `.stack-agent/preset` และไฟล์ `.stack-agent/*.json` ที่ต้องการแทนที่ แล้วรันใหม่

เครื่องมือใน `.stack-agent/bin/` ต้อง commit ไปกับโปรเจค (CI รันจากที่นั่น) จึงจะเห็นไฟล์ `.mjs` ไม่กี่ไฟล์ใน diff แม้โปรเจคไม่ได้ใช้ JavaScript `init` จะอัปเดตไฟล์เหล่านี้เมื่อคุณอัปเดต Stack Agent

## 1. Verification

แก้ `.stack-agent/verify.json` แทนที่ `EDIT ME` ทุกจุด

- `test.command` (หรือ `test.args`): คำสั่งรันเทสของ repo เช่น `npm test`, `pytest`, `go test ./...`, `cargo test`
- `server` (ใส่หรือไม่ก็ได้): วิธีเปิดโปรแกรมในเครื่อง พร้อม `env` และ `readyUrl` ที่ตอบเมื่อพร้อมใช้งาน
- `checks[]`: สิ่งที่ผู้ใช้ทำจริง แต่ละเรื่องต้องมีทั้งกรณีสำเร็จ และกรณีที่ต้องถูกปฏิเสธอย่างน้อยหนึ่งกรณี

check มีสองแบบ:

| แบบ | ฟิลด์ | ใช้กับ |
| --- | --- | --- |
| HTTP | `method`, `path`, `expectStatus` และใส่เพิ่มได้คือ `body`, `headers`, `expectJson`, `expectBodyIncludes` (ต้องมี `baseUrl`) | API, หน้าเว็บ |
| Command | `command` หรือ `args` และใส่เพิ่มได้คือ `expectExit` (ค่าเริ่มต้น 0), `expectOutputIncludes`, `expectOutputExcludes`, `expectOutputMatches`, `expectOutputFlags` (ค่าเริ่มต้น `m`), `needsServer`, `cwd`, `env`, `timeoutSec` (ค่าเริ่มต้น 120) | CLI, library, script, ตัวรัน e2e และอื่นๆ |

รายละเอียดของ command check:

- ระบุคำสั่งได้สองแบบ เลือกแบบเดียวเท่านั้น `"command": "pytest -q"` เป็นข้อความที่รันผ่าน shell ของระบบ คือ `cmd.exe` บน Windows และ `/bin/sh` บนระบบอื่น การใส่ quote จึงต่างกันตาม OS เพราะ `cmd.exe` ไม่ถือว่า single quote เป็นเครื่องหมายครอบ เช่น `python -c 'print(1)'` จะทำงานผิดบน Windows โดยไม่มีอะไรเตือน
- `"args": ["python", "-c", "print('hi there')"]` รันโปรแกรมตรงๆ โดยไม่ผ่าน shell แต่ละช่องใน array จะเป็น argument หนึ่งตัวพอดีบนทุก OS ให้ใช้ `args` กับทุกคำสั่งที่มี quote, มีเว้นวรรคอยู่ใน argument หรือมีอักขระอย่าง `&`, `|`, `%` ส่วน `test` และ `server` ก็ใช้ `args` ได้ หลักฐานจะบันทึก request เป็น args ที่ต่อกันด้วยเว้นวรรค พร้อม array `args`
- เมื่อไม่ผ่าน shell จะใช้ pipe, `&&`, glob หรือการแทนค่า `$VAR` ไม่ได้ และบน Windows `args` รันได้เฉพาะโปรแกรมจริง (`.exe`) ส่วน `npm`, `npx` และ script `.cmd` หรือ `.bat` อื่นๆ จะเปิดไม่ขึ้น (verify จะบอกและชี้มาที่นี่) ให้ใช้ `command` กับคำสั่งพวกนี้ (`"command": "npm test"`) หรือเรียก `node` พร้อม path ของ script
- เรียกชื่อตัวแปลภาษาให้ตรงกับที่ CI และเพื่อนร่วมทีมมี `python` มีบน Windows และเมื่อใช้ `actions/setup-python` แต่ macOS และ Debian แบบติดตั้งมาตรฐานมีแค่ `python3`
- output คือ stdout และ stderr รวมกัน การตรวจทุกแบบเห็น output ทั้งหมดได้ถึง 8 MB ถ้าเกินจะตัดส่วนกลางออกและ check จะ fail พร้อมบอกเหตุผล ให้ลด output ของคำสั่งที่พิมพ์เยอะมาก
- `expectOutputMatches` เป็น regex ของ JavaScript แยกตัวพิมพ์ใหญ่เล็กโดยค่าเริ่มต้น `expectOutputFlags` ใช้ตั้ง flag (ค่าเริ่มต้น `m` ทำให้ `^` และ `$` ตรงกับทุกบรรทัด ถ้าไม่สนตัวพิมพ์ใหญ่เล็กให้ใช้ `im`)
- command check ไม่เปิด server ให้ ถ้า check ไหนต้องใช้ server (เช่นเทสบนเบราว์เซอร์) ให้ใส่ `"needsServer": true`

```bash
node .stack-agent/bin/verify.mjs
```

ต้องได้ `verify: ok` ถ้าโปรแกรมต้องใช้ secret หรือฐานข้อมูลภายนอก ให้หาวิธีรันในเครื่องก่อน (docker compose, ฐานข้อมูลทดสอบ) ห้ามปลอม check เพื่อให้ผ่าน

พฤติกรรมที่ควรรู้:

- verify จะไม่ยุ่งกับ server ที่ไม่ได้เปิดเอง ถ้าพอร์ตมีคนใช้อยู่จะหยุดและบอก ถ้าตั้งใจยิง server ที่เปิดอยู่แล้วให้ใช้ `--reuse`
- server และคำสั่งเทสหรือ command check ที่รันเกินเวลา จะถูกปิดทั้ง process tree
- `baseUrl` มี path prefix ได้ เช่น `http://127.0.0.1:3999/api/v1`
- การรันที่นับว่าเสร็จคือการรันแบบไม่ใส่ flag (`latest.json` มี `"full": true`) ส่วน `--skip-tests`, `--skip-checks`, `--check` และ `--reuse` ใช้ระหว่างแก้ได้ แต่ Stop hook จะไม่นับเป็นหลักฐาน

## 2. Guard

ใส่กฎห้ามพลาด 3–5 ข้อใน `.stack-agent/guard.config.json` ทุกข้อต้องมี `message` และ `fix` ที่บอกว่าให้ใช้อะไรแทน เก็บกฎสากล 2 ข้อไว้ ส่วนกฎใน template ที่ไม่ตรงกับโครงสร้าง repo ให้ลบหรือแก้ guard จะเตือน `rule ... matches no files` ให้เห็น

| แบบ | ใช้เมื่อ | ฟิลด์ |
| --- | --- | --- |
| `pattern` | ข้อความที่ห้ามปรากฏในไฟล์บางกลุ่ม ใช้ได้ทุกภาษา | `files`, `pattern`, `flags`, `exclude` |
| `forbidden-import` | ไฟล์ JS/TS กลุ่มหนึ่งห้าม import ไฟล์หรือ package บางตัว | `files`, `to` (glob ของไฟล์ปลายทางที่ import ไปถึงจริง), `toSpecifiers` (glob ของชื่อ package) |
| `module-boundary` | โมดูล JS/TS คุยกันได้เฉพาะผ่าน public entry | `modulesRoot`, `publicEntry` |

**`forbidden-import` และ `module-boundary` เข้าใจเฉพาะ JavaScript และ TypeScript** ถ้าเป็นภาษาอื่นให้ลบออกจาก template แล้วเขียนกฎเดียวกันเป็นแบบ `pattern`

รายละเอียดที่ทำให้กฎไม่ทำงานโดยไม่มีใครรู้:

- pattern เป็น regex ของ JavaScript ไม่ใช่ของ Python หรือ PCRE ไวยากรณ์ที่มีเฉพาะใน Python เช่น `(?P<name>...)` จะ error
- pattern เป็นแบบ multiline เสมอ `^` และ `$` ตรงกับทุกบรรทัด ไม่ใช่แค่ต้นและท้ายไฟล์ ถ้าไม่สนตัวพิมพ์ใหญ่เล็กให้ใส่ `"flags": "i"`
- pattern อยู่ใน JSON จึงต้องเขียน backslash ซ้ำสองตัวเสมอ เช่น regex `\bSELECT\b` ต้องเขียน `"\\bSELECT\\b"` ถ้าเขียน `\b` ตัวเดียวใน JSON จะกลายเป็นตัวอักษร backspace และ guard จะแจ้ง config error
- `files`, `exclude`, `to`, `toSpecifiers`, `publicEntry`, `ignore` ต้องเป็น array ของ string ถ้าใส่เป็น string เดี่ยว guard จะแจ้ง config error
- โฟลเดอร์เหล่านี้ถูกข้ามเสมอ: `node_modules`, `.git`, `dist`, `build`, `coverage`, `__pycache__`, `.venv`, `venv`, `.tox`, `.pytest_cache`, `.mypy_cache`, `target`, `.stack-agent/evidence`, `.stack-agent/bin` ถ้าต้องการข้ามเพิ่มให้ใส่ใน `ignore`
- `to` เทียบกับไฟล์ที่ import ไปถึงจริง เช่น import `../db/index.js` ต้องเขียน `"to": ["src/db/**"]` ถ้าเขียน `"src/db"` จะไม่จับอะไรเลย
- glob รองรับ `*`, `**`, `?` และ `{js,ts}`
- import แบบ path alias (เช่น `@/modules/x`) ต้องตั้ง `"aliases": {"@/": "src/"}`
- กฎ import ข้าม import ที่อยู่ใน comment
- ภาษาอื่นให้เขียนเป็นกฎแบบ `pattern` เช่น `"files": ["app/api/**/*.py"], "pattern": "^from app\\.db import"`

```bash
node .stack-agent/bin/guard.mjs --update-baseline
node .stack-agent/bin/guard.mjs
```

คำสั่งแรกบันทึกของเดิมลง `guard-baseline.json` ต่อจากนั้น guard จะ fail เฉพาะเมื่อไฟล์ใดมีจุดผิดกฎเพิ่มขึ้น ratchet นับต่อไฟล์ต่อกฎ ถ้าในไฟล์เดียวกันแก้ของเก่าหนึ่งจุดแล้วเพิ่มของใหม่หนึ่งจุด จำนวนเท่าเดิมจึงผ่าน และถ้าเปลี่ยนชื่อไฟล์ ค่าในชื่อเก่าจะไม่ตามไปด้วย

การลด baseline ทำได้เสมอ แต่ถ้า `--update-baseline` เจอว่าจำนวนใดเพิ่มขึ้น มันจะไม่ยอมเขียนและ exit 1 การเพิ่มต้องใช้ `--allow-increase` ซึ่ง hook จะถามคนก่อน ยกเว้นตอนสร้าง baseline ครั้งแรกที่ยังไม่มีไฟล์

ข้อยกเว้นรายบรรทัดต้องมีเหตุผล วันหมดอายุ และคนอนุมัติ:

```js
// stack-agent-allow no-sql-in-controller reason="export report, ticket 42" until=2026-12-31 by=lead
```

- comment ที่อยู่บรรทัดของตัวเองใช้กับบรรทัดถัดไป ถ้าต่อท้ายโค้ดจะใช้กับบรรทัดนั้นบรรทัดเดียว
- วันที่ต้องเป็นวันจริงและไม่เกิน `maxAllowDays` (ค่าเริ่มต้น 90 วัน ตั้งได้) และชื่อกฎต้องมีอยู่จริง
- พอเลยวันหมดอายุ guard จะ fail อีกครั้ง
- guard พิสูจน์ไม่ได้ว่า `by=` อนุมัติจริง ส่วนนี้ต้องพึ่งการรีวิว (ดูหัวข้อถัดไป)

CI: `.github/workflows/stack-agent.yml` รัน guard, รัน `guard.mjs --compare-ref origin/<base>` ใน pull request (fail ถ้า baseline โตขึ้น หรือกฎถูกลบหรือแคบลง) และรันแผนที่ API เมื่อมี `api-map.json` ถ้าใช้ CI ระบบอื่นให้รันคำสั่งเดียวกัน

### ป้องกันไม่ให้ guard ถูกปิดเอง

ทางเลี่ยงกฎที่ง่ายที่สุดคือแก้ตัว guard เอง ระบบกันไว้สามชั้น:

1. **ตอนทำงาน:** hook ถามคนก่อนเมื่อ Edit/Write หรือคำสั่ง shell (Bash หรือ PowerShell) จะแก้ `guard.config.json`, `guard-baseline.json`, `.stack-agent/bin/` หรือ `stack-agent.yml`
2. **ใน CI:** `--compare-ref` fail เมื่อ baseline โตขึ้น หรือกฎถูกลบหรือแคบลง
3. **ในการรีวิว:** เพิ่ม `.github/CODEOWNERS` ให้คนที่ระบุต้องอนุมัติทุกการแก้ใน `.stack-agent/` เช่น `/.stack-agent/ @your-org/leads` (init ไม่ได้สร้างให้ เพราะไม่รู้ชื่อทีม)

ช่องโหว่ที่ยังเหลือ: hook PostToolUse ตรวจเฉพาะไฟล์ที่แก้ผ่าน Edit/Write ถ้าแก้ผ่านคำสั่ง shell (เช่น `sed -i`) CI และ Stop hook จะจับได้ทีหลัง ส่วน hook ที่ดักคำสั่ง shell ใช้การจับ pattern จึงไม่ครอบคลุมทุกรูปแบบ CI คือด่านที่ต้องมีเสมอ

## 3. Feature map (backend-http)

ข้ามขั้นนี้ถ้าไม่มี `.stack-agent/api-map.json` ถ้ามี ให้ตั้ง `sources` เป็น regex หนึ่งตัวหรือมากกว่าที่จับการประกาศ route โดยค่าเริ่มต้นกลุ่มที่ 1 คือ method และกลุ่มที่ 2 คือ path (เปลี่ยนได้ด้วย `methodGroup` และ `pathGroup`) ถ้า method ไม่ได้อยู่บรรทัดเดียวกับ path ให้แยก source ละหนึ่ง method แล้วใส่ `"method"` คงที่ ซึ่งกลุ่มที่ 1 จะกลายเป็น path

| Framework | `files` | `pattern` (ตามที่เขียนใน JSON) | เพิ่มเติม |
| --- | --- | --- | --- |
| Express | `["src/**/*.js"]` | `"router\\.(get\|post\|put\|patch\|delete)\\(\\s*['\"]([^'\"]+)"` | |
| FastAPI | `["app/**/*.py"]` | `"@\\w+\\.(get\|post\|put\|patch\|delete)\\(\\s*\"([^\"]+)\""` | |
| Flask (หนึ่ง method ต่อ route) | `["app/**/*.py"]` | `"@\\w+\\.route\\(\\s*\"([^\"]+)\""` | `"method": "GET"` |
| Go net/http 1.22+ | `["**/*.go"]` | `"HandleFunc\\(\\s*\"(GET\|POST\|PUT\|PATCH\|DELETE) ([^\"]+)\""` | |

route ที่รับหลาย method ในการประกาศเดียว (Flask `methods=[...]`, Django `path()`) ต้องแยก source ละหนึ่ง method หรือเขียน script เล็กๆ ที่สร้างแผนที่ให้

```bash
node .stack-agent/bin/api-map.mjs --draft > .stack-agent/api-map.md
node .stack-agent/bin/api-map.mjs
```

`--draft` ใส่คอลัมน์ Handler เป็นไฟล์และบรรทัดที่ประกาศ route ให้ชี้ไปที่ไฟล์ handler จริง (เขียนเป็น `path` หรือ `path:line` ก็ได้) แล้วเติม Calls และ Owner จากโค้ด แถวที่ไม่แน่ใจให้คงคำว่า `TODO` ไว้ให้คนตรวจ

คำสั่งที่สอง:

- **fail (exit 1)** เมื่อแผนที่กับโค้ดไม่ตรงกัน: route ในโค้ดไม่มีในแผนที่, แถวในแผนที่ไม่มี route จริง หรือ path ของ handler ไม่มีอยู่จริง
- **เตือนแต่ไม่ fail** เมื่อ endpoint ยังไม่มี verify check หรือแถวยังมี `TODO`

แผนที่เป็นตาราง markdown ที่คอลัมน์แรกเป็น HTTP method และคอลัมน์ที่สองเป็น path ตามที่ regex จับได้ route ที่ mount ใต้ prefix (เช่น `app.use("/items", router)`) จะไม่มี prefix เว้นแต่ regex จะรวมไว้

โปรเจคประเภทอื่นใช้หลักเดียวกันได้ (แผนที่จากสิ่งที่ผู้ใช้แตะไปยังโค้ดที่เกี่ยวข้อง) โดยเขียนเป็นไฟล์ markdown ธรรมดาให้ agent อ่านก่อน การเพิ่มตัวตรวจ drift ให้แผนที่แบบนี้เป็น preset ถัดไปที่น่าทำ

## 4. กฎของทีม และตรวจว่าตั้งค่าครบ

- เติม `.stack-agent/rules.md` ด้วยวิธีเขียนที่ทีมชอบ แล้วเพิ่ม `@.stack-agent/rules.md` ใน `CLAUDE.md` ของ repo ให้ทุก session โหลด
- เติม `.stack-agent/rules-table.md` ให้ทุกกฎห้ามพลาดมีแถว: กฎ, เหตุผล, อะไรบังคับมัน และหลักฐานว่าจับความผิดจริงได้

```bash
node <path-to-Stack_Agent>/scripts/init.mjs . --check
```

exit 0 แปลว่าตั้งค่าครบ ถ้าไม่ใช่จะบอกว่ายังเหลืออะไร

## 5. Skills

- `verify` ใช้ได้กับทุกโปรเจค
- สำหรับ backend มี `add-endpoint`, `add-migration` และ `api-map`
- เพิ่ม skill ของงานที่ทีมทำบ่อยที่สุด 2–3 อย่างใน `.claude/skills/<name>/SKILL.md` ถ้า agent ต้องเขียนโค้ดเดิมซ้ำ ให้เก็บเป็น script ไว้ในโฟลเดอร์ของ skill
- จบงานใหญ่แล้วใช้ `/stack-agent:reflect` เพื่อให้เสนอการแก้ skill จากสิ่งที่พลาด คุณต้องอนุมัติก่อนแก้
- เมื่อต้องแก้ agent เรื่องเดิมซ้ำสองครั้ง ใช้ `/stack-agent:correct` เปลี่ยนเป็นกฎ guard พร้อมพิสูจน์ว่ากฎจับได้จริง
- `/stack-agent:sample-review` สุ่มตรวจ commit ล่าสุด แล้วส่งปัญหาที่เจอซ้ำไปให้ `correct`

## 6. Evals

ทำเมื่อมี skill ให้วัดแล้ว ดู `/stack-agent:run-evals` ควรมีอย่างน้อย 1 case ต่อ skill และให้ดูส่วนต่างระหว่างมีกับไม่มี plugin ไม่ใช่ดูแค่คะแนน

## ที่ตั้งใจไม่ใส่

ไม่มี auto-merge และไม่มี outer loop ที่ดึงงานจาก Slack หรือ issue tracker ให้เริ่มจาก agent ทำงานแล้วคนรีวิว โดยใช้ agent `reviewer` ตรวจรอบแรก แล้วค่อยเพิ่มความอิสระเมื่อ verification กับ guard พิสูจน์ตัวเองแล้ว
