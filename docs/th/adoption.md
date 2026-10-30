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

อย่าให้ formatter และ linter ของโปรเจคไปยุ่งกับ `.stack-agent/` เพราะเครื่องมือถูก copy มาแบบตรงทุก byte (`--check` จะรายงานไฟล์ที่ถูกจัดรูปแบบใหม่ว่า `outdated`) และขั้น `prettier --check .` หรือ `eslint .` ใน CI ของคุณจะ fail เพราะไฟล์เหล่านี้ ถ้าโปรเจคใช้ Prettier (มี `.prettierignore`, ไฟล์ config ของ Prettier, key `prettier` ใน `package.json` หรือมี `prettier` เป็น dependency) `init` จะเพิ่ม `.stack-agent/` ลงใน `.prettierignore` และเพิ่มบรรทัดเดียวกันใน `.eslintignore` ถ้ามีไฟล์นี้อยู่แล้ว ถ้าโปรเจคอยู่ในโฟลเดอร์ย่อยของ repository จะทำแบบเดียวกันที่ระดับบนสุดของ repository ด้วย เพราะ `prettier --check .` ที่รันจาก root อ่านแค่ไฟล์ ignore ที่ root และบรรทัดนี้ตรงกับโฟลเดอร์ที่ทุกระดับความลึก ไฟล์ที่ ignore โฟลเดอร์นี้อยู่แล้ว หรือตั้งใจไม่ ignore ด้วย `!.stack-agent/` จะไม่ถูกแก้ ส่วน ESLint แบบ flat config (`eslint.config.*`) แก้ให้อย่างปลอดภัยไม่ได้ `--check` จึงเขียนโน้ตเมื่อไฟล์นั้น (ในโฟลเดอร์โปรเจคหรือที่ระดับบนสุดของ repository) ไม่มีคำว่า `.stack-agent` เลย ให้เพิ่ม `"**/.stack-agent/**"` ใน `ignores` เอง เครื่องมืออื่น (Biome, Ruff, pre-commit hook ที่จัดรูปแบบโค้ด) ให้เพิ่มโฟลเดอร์นี้ในรายการ ignore เอง

workflow CI ที่ `init` เขียนใช้ Node 22 หรือเวอร์ชันที่โปรเจคต้องการถ้าใหม่กว่า โดยดูจาก `.nvmrc` หรือ `.node-version` ก่อน (ข้ามบรรทัด comment) ไม่มีก็ใช้เวอร์ชันต่ำสุดที่ `engines.node` ใน `package.json` ยอมรับ (ขอบล่างที่น้อยที่สุดในแต่ละทางเลือกที่คั่นด้วย `||` ถ้าช่วงไม่มีขอบล่าง เช่น `<25` จะถือว่าไม่ได้ระบุ) อ่านจากโฟลเดอร์โปรเจคก่อน แล้วจึงอ่านที่ระดับบนสุดของ repository สคริปต์ของ Stack Agent เองต้องใช้ Node 22 workflow จึงไม่ต่ำกว่านั้น `--check` เขียนโน้ตเมื่อ `node-version` ใน workflow เก่ากว่าที่โปรเจคต้องการ หรือเก่ากว่า 22

`init` เขียน `.stack-agent/.gitattributes` (`* text eol=lf`) ด้วย เครื่องมือจึงเป็น LF ทุกระบบปฏิบัติการ Git for Windows แปลงไฟล์เป็น CRLF ตอน checkout เป็นค่าเริ่มต้น (`core.autocrlf=true`) และ `--check` กับ SessionStart hook จะเทียบเครื่องมือกับสำเนาของ plugin สำเนาที่ต่างกันแค่ตัวขึ้นบรรทัดถือว่าเป็นเครื่องมือเดียวกัน โปรเจคที่รัน Prettier บน Windows อาจต้องใส่ `* text=auto eol=lf` ใน `.gitattributes` ของตัวเองด้วยเหตุผลเดียวกัน workflow ที่ `init` เขียนรันด้วย token แบบอ่านอย่างเดียว (`permissions: contents: read`) เพราะ job ไม่ได้เขียนอะไรกลับ และขั้นติดตั้งรันสคริปต์ของ package ภายนอก

## 1. Verification

แก้ `.stack-agent/verify.json` แทนที่ `EDIT ME` ทุกจุด

- `test.command` (หรือ `test.args`): คำสั่งรันเทสของ repo เช่น `npm test`, `pytest`, `go test ./...`, `cargo test` และรับ `cwd`, `env`, `timeoutSec` (ค่าเริ่มต้น 600) ได้ด้วย
- `server` (ใส่หรือไม่ก็ได้): วิธีเปิดโปรแกรมในเครื่อง พร้อม `env` และ `readyUrl` ที่ตอบเมื่อพร้อมใช้งาน และ `readyTimeoutSec` (ค่าเริ่มต้น 30) คือเวลาที่ verify รอให้พร้อม
- `checks[]`: สิ่งที่ผู้ใช้ทำจริง แต่ละเรื่องต้องมีทั้งกรณีสำเร็จ และกรณีที่ต้องถูกปฏิเสธอย่างน้อยหนึ่งกรณี

check มีสองแบบ:

| แบบ | ฟิลด์ | ใช้กับ |
| --- | --- | --- |
| HTTP | `method`, `path`, `expectStatus` และใส่เพิ่มได้คือ `body`, `headers`, `expectJson`, `expectBodyIncludes`, `expectHeaders`, `followRedirects` (ค่าเริ่มต้น `true`), `timeoutSec` (ค่าเริ่มต้น 10) (ต้องมี `baseUrl`) | API, หน้าเว็บ |
| Command | `command` หรือ `args` และใส่เพิ่มได้คือ `expectExit` (ค่าเริ่มต้น 0), `expectOutputIncludes`, `expectOutputExcludes`, `expectOutputMatches`, `expectOutputFlags` (ค่าเริ่มต้น `m`), `needsServer`, `cwd`, `env`, `timeoutSec` (ค่าเริ่มต้น 120) | CLI, library, script, ตัวรัน e2e และอื่นๆ |

check ที่มี `command` หรือ `args` เป็น command check ส่วนแบบอื่นเป็น HTTP check และระบุให้ชัดได้ด้วย `"type": "http"` หรือ `"type": "command"`

รายละเอียดของ command check:

- ระบุคำสั่งได้สองแบบ เลือกแบบเดียวเท่านั้น `"command": "pytest -q"` เป็นข้อความที่รันผ่าน shell ของระบบ คือ `cmd.exe` บน Windows และ `/bin/sh` บนระบบอื่น การใส่ quote จึงต่างกันตาม OS เพราะ `cmd.exe` ไม่ถือว่า single quote เป็นเครื่องหมายครอบ เช่น `python -c 'print(1)'` จะทำงานผิดบน Windows โดยไม่มีอะไรเตือน
- `"args": ["python", "-c", "print('hi there')"]` รันโปรแกรมตรงๆ โดยไม่ผ่าน shell แต่ละช่องใน array จะเป็น argument หนึ่งตัวพอดีบนทุก OS ให้ใช้ `args` กับทุกคำสั่งที่มี quote, มีเว้นวรรคอยู่ใน argument หรือมีอักขระอย่าง `&`, `|`, `%` ส่วน `test` และ `server` ก็ใช้ `args` ได้ หลักฐานจะบันทึก request เป็น args ที่ต่อกันด้วยเว้นวรรค พร้อม array `args`
- เมื่อไม่ผ่าน shell จะใช้ pipe, `&&`, glob หรือการแทนค่า `$VAR` ไม่ได้ และบน Windows `args` รันได้เฉพาะโปรแกรมจริง (`.exe`) ส่วน `npm`, `npx` และ script `.cmd` หรือ `.bat` อื่นๆ จะเปิดไม่ขึ้น (verify จะบอกและชี้มาที่นี่) ให้ใช้ `command` กับคำสั่งพวกนี้ (`"command": "npm test"`) หรือเรียก `node` พร้อม path ของ script
- เรียกชื่อตัวแปลภาษาให้ตรงกับที่ CI และเพื่อนร่วมทีมมี `python` มีบน Windows และเมื่อใช้ `actions/setup-python` แต่ macOS และ Debian แบบติดตั้งมาตรฐานมีแค่ `python3`
- output คือ stdout และ stderr รวมกัน การตรวจทุกแบบเห็น output ทั้งหมดได้ถึง 8 MB ถ้าเกินจะตัดส่วนกลางออกและ check จะ fail พร้อมบอกเหตุผล ให้ลด output ของคำสั่งที่พิมพ์เยอะมาก คำสั่งที่จบไปแล้วแต่ process ที่มันเปิดไว้ยังถือ output อยู่ (เซิร์ฟเวอร์ที่เปิดด้วย `&` หรือ `start /b`) จะตัดสินจาก exit code เมื่อ output เงียบไป 1.5 วินาที (รอนานสุด 10 วินาที) verify จะบอกเรื่องนี้ใน output และหยุด process นั้น (บน Windows คือ process ที่คำสั่งเปิดไว้ ซึ่งหาจาก parent id) คำสั่งที่ถูก signal ฆ่าจะรายงานเป็น `killed by SIGSEGV` (หรือ signal ที่เกิด) ไม่ใช่ exit code และถ้า verify เองถูกหยุดด้วย Ctrl+C หรือ SIGTERM จะหยุดเซิร์ฟเวอร์และคำสั่งที่มันเปิดไว้ก่อนจบ
- `expectOutputMatches` เป็น regex ของ JavaScript แยกตัวพิมพ์ใหญ่เล็กโดยค่าเริ่มต้น `expectOutputFlags` ใช้ตั้ง flag (ค่าเริ่มต้น `m` ทำให้ `^` และ `$` ตรงกับทุกบรรทัด ถ้าไม่สนตัวพิมพ์ใหญ่เล็กให้ใช้ `im`)
- command check ไม่เปิด server ให้ ถ้า check ไหนต้องใช้ server (เช่นเทสบนเบราว์เซอร์) ให้ใส่ `"needsServer": true`

```bash
node .stack-agent/bin/verify.mjs
```

รายละเอียดของ HTTP check:

- โดยปกติจะตาม redirect ไปจนสุด check จึงเห็นหน้าที่ผู้ใช้ไปถึงจริง ถ้าต้องการเห็นตัว redirect เอง ให้ตั้ง `"followRedirects": false` เช่นหน้าที่ต้องส่งผู้ใช้ที่ยังไม่ login ไป `/login`: `{"method": "GET", "path": "/dashboard", "followRedirects": false, "expectStatus": 307, "expectHeaders": {"location": "/login"}}`
- `expectHeaders` จับคู่ชื่อ header (ตัวพิมพ์ใหญ่เล็กไม่สำคัญ) กับข้อความที่ค่าของ header ต้องมี ถ้าไม่มี header นั้น check จะ fail
- HTTP check แต่ละตัวคือ request เดียว ไม่มีการส่ง cookie ต่อกัน ขั้นตอนที่ต้อง login ก่อน (login แล้วทำงานในฐานะผู้ใช้นั้น) ให้เขียนสคริปต์สั้นๆ ที่ส่ง request เองแล้วพิมพ์ข้อความยืนยัน แล้วรันเป็น command check ที่มี `"needsServer": true` และ `"expectOutputIncludes"`

ต้องได้ `verify: ok` ถ้าโปรแกรมต้องใช้ secret หรือฐานข้อมูลภายนอก ให้หาวิธีรันในเครื่องก่อน (docker compose, ฐานข้อมูลทดสอบ) ห้ามปลอม check เพื่อให้ผ่าน

### โปรแกรมที่ต้องมีฐานข้อมูลหรือผู้ใช้ทดสอบ

`server` เปิดได้ process เดียว ถ้าโปรแกรมต้องเตรียมอย่างอื่นก่อนจะตอบได้ (ฐานข้อมูล, migration, ผู้ใช้ทดสอบ) ให้ชี้ `server` ไปที่สคริปต์สั้นๆ ใน repository ที่ทำขั้นตอนเหล่านั้นแล้วเปิดโปรแกรมค้างไว้ เช่น `"server": {"args": ["node", "scripts/verify-env.mjs", "serve"], ...}` ถ้า integration test ต้องใช้ฐานข้อมูลด้วย ก็ให้ขั้น test ใช้วิธีเดียวกัน สิ่งที่ทำให้ใช้ได้จริงในการติดตั้งครั้งแรกกับโปรเจคจริง (แอป Next.js บน PostgreSQL บน Windows):

- ฐานข้อมูลใหม่ทุกครั้งในโฟลเดอร์ temp ของเครื่อง (แบบ embedded หรือ container) ไม่ใช้ฐานข้อมูลของนักพัฒนา
- secret ที่โปรแกรมจะอ่านจาก `.env` ให้สคริปต์ตั้งเป็นค่าว่าง verify จะได้ไม่ส่งอีเมลจริงหรือเรียก API ที่เสียเงิน ตัวโหลด env หลายตัว (`node --env-file`, `process.loadEnvFile`, dotenv) ไม่ทับตัวแปรที่ตั้งไว้แล้ว
- เลือกพอร์ตว่างตอนเริ่มให้ฐานข้อมูล ไม่ใช้พอร์ตตายตัว เพราะบน Windows process ลูกของฐานข้อมูลตัวเก่าอาจถือพอร์ตไว้ต่อหลัง process แม่ปิดแล้ว
- ใช้โฟลเดอร์ build หรือ cache แยก ถ้า framework ไม่ยอมเปิด dev server ตัวที่สองในโฟลเดอร์เดียวกัน (Next.js 16 เป็นแบบนี้) verify จะได้รันได้แม้นักพัฒนาเปิด dev server ค้างไว้
- บน Windows verify ปิด server ด้วย `taskkill /T /F` ขั้นเก็บกวาดของสคริปต์จึงไม่ได้รัน ให้สคริปต์เขียน process id ลงในโฟลเดอร์ temp ของตัวเอง แล้วตอนเริ่มให้ลบโฟลเดอร์ที่ process เจ้าของไม่อยู่แล้ว บน Linux และ macOS verify ส่ง SIGTERM ก่อน ขั้นเก็บกวาดใน signal handler จึงได้รัน

พฤติกรรมที่ควรรู้:

- verify จะไม่ยุ่งกับ server ที่ไม่ได้เปิดเอง ถ้าพอร์ตมีคนใช้อยู่จะหยุดและบอก ถ้าตั้งใจยิง server ที่เปิดอยู่แล้วให้ใช้ `--reuse`
- server และคำสั่งเทสหรือ command check ที่รันเกินเวลา จะถูกปิดทั้ง process tree
- `baseUrl` มี path prefix ได้ เช่น `http://127.0.0.1:3999/api/v1`
- การรันที่นับว่าเสร็จคือการรันแบบไม่ใส่ flag (`latest.json` มี `"full": true`) ส่วน `--skip-tests`, `--skip-checks`, `--check` และ `--reuse` ใช้ระหว่างแก้ได้ แต่ Stop hook จะไม่นับเป็นหลักฐาน มีสอง flag ที่เปลี่ยนแค่วิธีอ่านหรือรายงานผล: `--config FILE` อ่าน verify.json ไฟล์อื่น และ `--json` พิมพ์บันทึกหลักฐาน (รวม body ของ HTTP และ log ของเซิร์ฟเวอร์) แทนสรุป
- `--check <name> --repeat N` (N ตั้งแต่ 2 ถึง 1000) รันแต่ละเช็กที่ระบุ N รอบแล้วรายงานว่ากี่รอบที่ red ใช้กับบั๊กที่ล้มเหลวเป็นบางรอบ: `RED check list x30: GET /items -> red in 7 of 30 runs (23%)` ตามด้วยความล้มเหลวแต่ละแบบพร้อมจำนวนครั้งที่เกิด และ output ของรอบแรกที่ red ชุดเทสต์จะไม่ถูกรัน ถ้า repro เป็นเทสต์ ใช้ `--skip-checks --repeat N` เพื่อรันชุดเทสต์ N รอบแทน (`RED tests x20: ...`) และจะไม่รันเช็กใด เซิร์ฟเวอร์เริ่มครั้งเดียวและเปิดค้างไว้ตลอด N รอบ ดังนั้น state ที่รอบหนึ่งทิ้งไว้อาจส่งผลถึงรอบถัดไป ถ้าต้องการ process ใหม่ทุกรอบ ให้ทำ repro เป็น command check รอบที่ timeout, เริ่มไม่ได้ หรือไม่มีการตอบกลับ นับเป็น red และถูกระบุว่า inconclusive ด้วย exit code เป็น 1 เมื่อมีรอบใด red เป็นการรันบางส่วนแบบเดียวกับ `--check` จึงไม่รัน against step และไม่นับว่าเสร็จ
- หลักฐานบันทึก fingerprint ของโค้ดตอนเริ่มรัน คือ git blob id ของทุกไฟล์ที่ git มองเห็นในโปรเจกต์ (ไฟล์ที่ track หรือไฟล์ใหม่ที่ไม่ได้ gitignore) ยกเว้นเอกสาร `*.md` และ `.stack-agent/` (รายการ `stopHookIgnore`) แต่นับ `verify.json` เสมอ ไฟล์ที่ gitignore เช่น `.env` ไม่นับ การ commit ไม่ทำให้ค่าเปลี่ยน แต่ถ้าแก้โค้ดหรือ check ภายหลังค่าจะเปลี่ยน ถ้าการรันเปลี่ยนไฟล์เอง (snapshot, codegen, ฐานข้อมูลที่อยู่นอกโฟลเดอร์ที่ gitignore) จะแสดงรายชื่อใน output และ Stop hook จะไม่รับหลักฐานนั้น ไฟล์ใหม่ให้ gitignore ส่วนไฟล์ที่ track อยู่แล้วแต่การรันเขียนทับ (รายงาน coverage, fixture) ให้ใส่ใน `stopHookIgnore` ซึ่งมีผลใน session ถัดไป

### ขั้น against: check ใหม่ต้อง fail กับโค้ดก่อนแก้

check หรือเทสที่ผ่านทั้งก่อนและหลังแก้ไม่ได้ทดสอบการแก้นั้น หลังรันครบและผ่าน verify จะเอา check ที่เพิ่มใหม่ใน `verify.json` เทียบกับ commit อ้างอิง และชุดเทสเมื่อไฟล์เทสเปลี่ยนตั้งแต่ commit นั้น ไปรันกับโค้ดที่ commit นั้นใน git worktree ชั่วคราว

- ต้องมี check ใหม่ หรือชุดเทสที่เปลี่ยน อย่างน้อยหนึ่งอย่างที่ fail กับโค้ดเก่า ถ้าผ่านกับโค้ดเก่าทั้งหมด การรันจะ fail ด้วย `FAIL against` พร้อมชื่อ ส่วนใหญ่แก้ได้ด้วยการเพิ่มกรณีที่ต้องถูกปฏิเสธ (input ผิดต้องโดนปฏิเสธ) ซึ่งโค้ดเก่ายอมรับ
- unit test นับเท่ากับ verify check: ระบบรันเทสปัจจุบันกับโค้ดเก่า ถ้า fail จะบันทึกเป็น `tests (<คำสั่งเทส>)` ใน `detecting` ขั้นนี้ดูผลของทั้งชุดเทส เทสที่ fail กับโค้ดเก่าด้วยเหตุผลอื่น (ไฟล์ fixture หรือ `.env` ที่ checkout เก่าไม่มี หรือเทสที่ผลไม่แน่นอน) ก็จะถูกนับว่าจับได้ด้วย เทสที่ล้มเพราะ import สิ่งที่โค้ดเก่าไม่มี (โมดูลหรือ export ที่หายไป) นับเป็น inconclusive เช่นเดียวกับชุดเทสที่รันจนหมดเวลา เทสที่ต้องรอสิ่งที่โค้ดเก่าไม่ทำ (การเรียก webhook หรือข้อความ) ควรตั้ง timeout สั้นๆ ของตัวเอง เพื่อให้ fail แทนที่จะค้าง เทสที่เปลี่ยนแต่ผ่านกับโค้ดเก่าจะทำให้ขั้นนี้ข้าม ไม่ใช่ fail เพราะการ refactor ก็เป็นแบบนี้ มีแค่ check ใหม่ที่ผ่านกับโค้ดเก่าเท่านั้นที่ทำให้การรัน fail ไฟล์เทสที่ถูกลบไม่นับเป็นการเปลี่ยน
- กรณีที่พบบ่อย: การแก้เพิ่ม export ใหม่ และเทสของมัน import export นั้น บนโค้ดเก่าเทสจึงล้มตั้งแต่ import และพิสูจน์อะไรไม่ได้ verify จะบอกตามนั้น พร้อมชื่อที่อ่านได้จาก output ของเทส (`SKIP against: the changed tests import something the code at ... does not have (monthlyTotals)`) และหลักฐานบันทึก `importMissing` กับ `missingImports` ให้เพิ่ม verify check ที่ fail เมื่อไม่มีการแก้ โดยรันโปรแกรมแบบที่ผู้ใช้ใช้กับ input ที่ไปถึงโค้ดใหม่ หรือถ้ายังไม่มีอะไรเรียกโค้ดใหม่ ให้ใช้ command check ที่ import ฟังก์ชันใหม่แล้วพิมพ์ผล บนโค้ดเก่า check แบบนี้จะ fail (เพราะไม่มี export) และนั่นคือการจับการแก้ได้
- check ใหม่ที่ผ่านกับโค้ดเก่าไม่เป็นไร ถ้ามีอีกตัวที่ fail กรณีที่สำเร็จมักผ่านตั้งแต่ก่อนแก้อยู่แล้ว
- commit อ้างอิงคือ HEAD ตอนที่ session ของ Claude เริ่ม (SessionStart hook บันทึกไว้) การ commit ระหว่างทำงานจึงไม่ทำให้การแก้หายไปจากการเทียบ ถ้าไม่มีบันทึกของ session จะใช้ `HEAD` และกำหนดเองได้ด้วย `--against <ref>` ถ้ารัน verify ใน CI ให้ใส่ `--against origin/<base branch>` เพราะใน CI ค่า `HEAD` มีการแก้อยู่แล้ว ขั้นนี้จะข้ามไป
- ขั้นนี้จะข้ามและบอกเหตุผลใน output เมื่อ: โปรเจกต์ไม่อยู่ใน git, ไม่มี `verify.json` ที่ commit อ้างอิง, ไม่มี check ใหม่และไม่มีไฟล์เทสเปลี่ยน (การเปลี่ยนชื่อ check หรือแก้แค่ `timeoutSec` ไม่นับ) หรือแก้แค่ check กับไฟล์เทส (เพิ่มการทดสอบให้พฤติกรรมเดิม) เทสที่ import โมดูลที่โค้ดเก่าไม่มีนับเป็น inconclusive ไม่ใช่การจับได้ check ที่ถูกลบตั้งแต่ commit อ้างอิงจะแสดงรายชื่อ และ check ที่ถูกแก้โดยใช้ชื่อเดิมก็แสดงด้วย (ตัวที่แก้จะรันเหมือน check ใหม่)
- ผลที่พิสูจน์อะไรไม่ได้นับเป็น "inconclusive" และข้ามขั้นนี้แทนที่จะให้ผ่าน: server ของโค้ดเก่าเปิดไม่ขึ้น, คำสั่งรันไม่ได้ จบด้วย exit 127 หมดเวลา หรือแจ้งว่าหาโมดูลหรือโปรแกรมไม่เจอ (มักเป็นไฟล์ build ที่ gitignore เช่น `dist/` ซึ่ง checkout เก่าไม่มี), request ต่อไม่ได้ ถ้าต้องการให้กรณีเหล่านี้ fail ให้ตั้ง `"against": { "required": true }`
- ค่าเริ่มต้น ถ้าแก้โค้ดโดยไม่มี check หรือเทสที่ใหม่หรือเปลี่ยน ขั้นนี้จะข้ามพร้อมหมายเหตุ (และ Stop hook จะขอเทสหนึ่งครั้ง) CI จึงผ่าน ตั้ง `"against": { "requireNewCoverage": true }` เพื่อให้ CI เป็นด่านจริง verify จะ fail พร้อมข้อความนั้น การเปลี่ยนที่ไม่เปลี่ยนพฤติกรรม (refactor, เปลี่ยนชื่อ) ผ่อนได้ด้วยบรรทัดที่ขึ้นต้นด้วย `Stack-Agent-No-New-Test: <เหตุผล>` (อย่างน้อย 15 ตัวอักษร) ใน commit message ใดก็ได้หลัง base เหตุผลจะแสดงในผล verify และอยู่ในประวัติให้ผู้รีวิวอ่าน การแก้เฉพาะเอกสารยังข้ามเหมือนเดิม ตัวเลือกนี้แยกจาก `required` การเปิดอันหนึ่งไม่กระทบอีกอัน
- worktree จะได้ `verify.json` ปัจจุบันและไฟล์เทสปัจจุบัน (`test/**`, `tests/**`, `__tests__/**`, `*.test.*`, `*.spec.*`, `test_*.py`, `*_test.py`, `*_test.go` เปลี่ยนได้ด้วย `against.keep`) และลิงก์ `node_modules` จากโปรเจกต์เข้าไป รวมถึง `node_modules` ของ workspace package ที่อยู่ลึกลงไปหนึ่งหรือสองชั้น (`apps/web/node_modules`, `packages/core/node_modules` แบบที่ pnpm, Yarn และ npm workspaces สร้าง) ถ้าตั้ง `against.link` จะใช้รายการนั้นแทน เดิมถ้าไม่ลิงก์โฟลเดอร์เหล่านี้ เทสของ monorepo จะ fail ใน worktree เพราะหา package ไม่เจอ และถูกอ่านว่าจับการเปลี่ยนแปลงได้ ถ้าโค้ดเก่าต้อง build หรือติดตั้งก่อน ให้ใส่ `command` หรือ `args` ใน `against.setup` เมื่อมี setup จะไม่ลิงก์อะไรเลยถ้าไม่ได้ตั้ง `against.link` เพราะการติดตั้งผ่านลิงก์จะเขียนทับโฟลเดอร์จริง ห้ามใส่คำสั่งติดตั้งใน `setup` พร้อมกับลิงก์ `node_modules` ส่วน `against.tmpDir` ใช้ย้าย worktree ออกจากไดรฟ์ระบบที่เล็ก git hook ไม่ทำงานตอน checkout ลิงก์ถูกลบก่อนลบ worktree และของค้างจากการรันที่ถูกฆ่าจะถูกเก็บกวาดหลังสองชั่วโมง
- ใน repository ขนาดใหญ่ การ checkout คือส่วนที่ช้า (ราว 30 วินาทีในการ checkout และ 11 วินาทีในการลบที่ 100,000 ไฟล์ ดู design notes) `against.paths` จะ checkout เฉพาะ folder ของโปรเจกต์เอง folder ที่ระบุไว้ (นับจากโปรเจกต์ เช่น `["../packages/shared"]` สำหรับโค้ดที่ import) และไฟล์ที่ root ของ repository โดยใช้ sparse checkout ของ git ถ้าไม่ใส่จะ checkout ทั้งหมดเหมือนเดิม ถ้า folder ที่โค้ดเก่าต้องใช้ไม่อยู่ในรายการ เทสหรือ check จะเริ่มไม่ได้ ซึ่งนับเป็น inconclusive ไม่ใช่การจับการแก้ได้
- ปิดด้วย `--no-against` หรือ `"against": false` หลักฐานจะบันทึกไว้ และ Stop hook จะรับก็ต่อเมื่อ session เริ่มด้วย `"against": false` อยู่แล้ว การปิดขั้นนี้หลังเจอ `FAIL against` จึงผ่านไม่ได้ การรันบางส่วนจะไม่รันขั้นนี้ ขั้นนี้เปิด server รอบที่สอง จึงใช้เวลาเพิ่มเมื่อมี check ใหม่

### Stop hook

ค่าเริ่มต้น (`"stopHook": "block"`) Stop hook จะไม่ให้ agent จบงาน ถ้าโค้ดที่แก้ใน session นี้ยังไม่มีหลักฐานที่ตรงกัน ตรงกันหมายถึงการรันครบที่ผ่าน และ fingerprint ตรงกับโค้ดปัจจุบัน

- ก่อนอย่างอื่น hook จะรัน guard กับไฟล์ที่ session แก้ (ทั้งใน working tree และที่ commit ไปหลังเริ่ม session) เทียบกับ baseline แบบเดียวกับ CI ถ้ามีการผิดกฎใหม่ จะบล็อกพร้อมชื่อกฎและวิธีแก้ แม้จะแก้ผ่าน shell (`sed -i` หรือ script) แล้ว agent ไม่ได้แก้ตามที่ hook หลังคำสั่ง shell รายงาน ไฟล์ skip ใช้ยกเว้นเรื่องนี้ไม่ได้ ไฟล์ที่คุณแก้ค้างไว้ก่อนเริ่ม session และ agent ไม่ได้แตะจะไม่ถูกนับ และยังใช้เพดานบล็อก 3 ครั้งเหมือนเดิม
- นับเฉพาะสิ่งที่แก้ใน session นี้ ถ้าโค้ดมีการแก้ค้างไว้ก่อนเริ่ม session จะไม่ถูกบล็อกและไม่ถูกแสดงในรายชื่อ การ commit งานไม่ทำให้หลุด เพราะ hook เทียบกับ fingerprint ที่บันทึกตอนเริ่ม session
- ค่า `stopHook`, `stopHookIgnore`, `evidenceDir` (ค่าเริ่มต้น `.stack-agent/evidence`) และ `against` อ่านตอนเริ่ม session และเก็บในบันทึกของ session ที่ตำแหน่งตายตัว (`.stack-agent/evidence/sessions/` ไม่ว่า `evidenceDir` จะตั้งเป็นอะไร) การแก้ค่าเหล่านี้ใน `verify.json` จึงมีผลใน session ถัดไป ไม่ใช่กลาง session ที่กำลังถูกตรวจ และผลการรัน verify ที่ใช้ `stopHookIgnore` ต่างจากตอนเริ่ม session จะไม่ถูกรับ
- ถ้า SessionStart hook ไม่ได้ทำงาน (เปิด plugin กลาง session) บันทึกจะถูกเขียนก่อนที่ agent จะใช้ Edit, Write, MultiEdit, NotebookEdit หรือรันคำสั่ง shell ครั้งแรกแทน การแก้ผ่านเครื่องมืออื่นก่อนหน้านั้น (เช่นเครื่องมือแก้ไฟล์ของ MCP) จะไม่อยู่ในบันทึก มีแค่กรณีที่ agent จบงานก่อนใช้เครื่องมือเหล่านี้เท่านั้นที่ hook จะใช้ `git status` และค่าปัจจุบัน
- บันทึกตั้งต้นถูกสร้างได้ครั้งเดียวต่อ session (มีโน้ตในโฟลเดอร์ข้อมูลของ plugin หรือโฟลเดอร์ temp ของระบบจำไว้) การลบบันทึกจึงไม่ทำให้เริ่มนับใหม่ hook จะบล็อกต่อด้วยเหตุผล "the session record was removed" จนกว่างานจะถูก verify หรือ skip คำสั่ง shell ที่ลบ ย้าย หรือเขียนทับบันทึกหรือโน้ตเหล่านี้ (รวมถึงแบบใช้ glob) จะถามคนก่อน ส่วนการอ่านไม่ถาม ด่านนี้เป็นแค่ด่านเบื้องต้น agent ที่ตั้งใจลบทั้งสองอย่างผ่านคำสั่งทางอ้อมยังหลุดได้ ด่านสุดท้ายจึงเป็น CI ไม่ใช่ hook
- ถ้ารัน verify ไม่ได้จริงๆ (ไม่มีฐานข้อมูล ไม่มีเน็ต) agent ต้องบันทึกเหตุผลด้วย `node .stack-agent/bin/verify.mjs --skip "<เหตุผล>"` (อย่างน้อย 15 ตัวอักษร) ถ้ารันคำสั่งไม่ได้เลย (sandbox ไม่มี Node หรือไฟล์เป็นแบบอ่านอย่างเดียว) ให้ปิดข้อความสุดท้ายด้วยบรรทัด `stack-agent-skip: <เหตุผล>` แล้ว Stop hook ซึ่งทำงานนอก sandbox จะบันทึกการข้ามแบบเดียวกันให้ ระบบนับเฉพาะบรรทัดสุดท้ายของข้อความ การยกตัวอย่างบรรทัดนี้ไว้ก่อนหน้าจึงไม่มีผล ถ้าผู้ใช้สั่งไม่ให้ตรวจ ให้ระบุไว้ในเหตุผลด้วย คำสั่งนี้เขียน `.stack-agent/verify-skip.json` ซึ่งเป็นไฟล์ที่ git มองเห็น (ไม่ได้ gitignore) จึงโผล่ใน `git status` และใน diff เมื่อ add แล้ว และ hook จะแสดงเหตุผลให้คุณเห็นหนึ่งครั้ง การ skip ใช้ได้กับโค้ดชุดที่บันทึกไว้เท่านั้น ถ้าแก้ต่อต้อง verify หรือ skip ใหม่
- ถ้าบล็อกครบ 3 ครั้งติดกัน hook จะปล่อยให้ agent จบ และบอกคุณว่ามีการแก้ที่ยังไม่ได้ verify เพื่อไม่ให้ agent ที่ติดวนรันไปเรื่อยๆ ข้อความใหม่จากคุณจะเริ่มนับใหม่
- การใช้ Edit/Write กับ `latest.json`, `verify-skip.json` หรือบันทึก session ใน `evidence/sessions/` จะถามคนก่อน ไฟล์เหล่านี้ให้สคริปต์ของ Stack Agent เขียนเท่านั้น `evidenceDir` ที่ตั้งเองก็ได้รับการป้องกันด้วย ทั้งค่าตอนเริ่ม session และค่าปัจจุบันใน `verify.json` การเขียนผ่าน shell แบบตั้งใจยังแก้ไฟล์เหล่านี้ได้ CI คือด่านที่ผ่านไม่ได้
- เมื่อหลักฐานตรงกับโค้ดแล้ว แต่ขั้น against ออกมา inconclusive เพราะเทสที่เปลี่ยน import สิ่งที่โค้ดเก่าไม่มี (และไม่ได้เพิ่ม check ใหม่) hook จะบล็อกอีกหนึ่งครั้งเพื่อขอ check ที่ fail เมื่อไม่มีการแก้ โดยระบุชื่อที่ import และยกตัวอย่าง command check ที่เรียกฟังก์ชันใหม่โดยตรงสำหรับโค้ดที่ยังไม่มีอะไรเรียก ถ้า agent หยุดอีกครั้งโดยไม่เพิ่ม จะปล่อยให้จบ โหมด `"stopHook": "remind"` ไม่ถามเรื่องนี้ ใน A/B เมื่อ 23 ต.ค. ข้อความรุ่นก่อนที่บอกว่า "ถ้าไม่มีอะไรที่ผู้ใช้รันได้ ให้บอกแล้วหยุด" ถูกใช้เป็นทางออกครบ 4 จาก 4 รอบ
- ในทำนองเดียวกัน เมื่อหลักฐานตรงกับโค้ดแล้ว แต่โค้ดเปลี่ยนโดยไม่มี check หรือเทสใหม่หรือที่เปลี่ยนเลย (ขั้น against จึงไม่มีอะไรให้รันและบันทึก `noNewCoverage`) hook จะบล็อกหนึ่งครั้งเพื่อขอเทสหรือ check ที่ fail เมื่อไม่มีการแก้ หรือให้ agent บอกว่าไม่มีอะไรที่ผู้ใช้สังเกตได้เปลี่ยนไป การเปลี่ยนเฉพาะไฟล์ที่ fingerprint ไม่นับ (เอกสาร, `*.md`) จะไม่ถูกถาม เจอใน A/B ของ `job-new-export` ที่มี agent รอบละหนึ่งตัวแก้โค้ดโดยไม่เขียนเทส แล้ว verify และหยุด
- `"stopHook": "remind"` กลับไปใช้พฤติกรรมเดิม คือเตือนครั้งเดียวต่อชุดการแก้ แล้ว agent จบได้

### ข้อความภาษาไทย

hook พูดภาษาอังกฤษเป็นค่าเริ่มต้น ถ้าอยากให้ข้อความที่คนอ่าน กับคำตอบของ agent เป็นไทยง่ายๆ ให้ตั้ง `"language": "th"` ใน `.stack-agent/verify.json` หรือตั้งตัวแปร `STACK_AGENT_LANG=th` (ตัวแปรชนะไฟล์ `"en"` กลับเป็นอังกฤษ ค่าอื่นนับเป็นอังกฤษ) มันเปลี่ยนสี่อย่าง คือข้อความตอนเริ่ม session ที่บอกว่าเครื่องมือที่ copy ไว้ในโปรเจคไม่ตรงกับของปลั๊กอิน ข้อความตอน Stop hook ปล่อย agent ไปหลังเตือนครบแล้ว หรือหลัง agent บอกว่าตรวจไม่ได้ คำถามในกล่องขออนุญาตก่อนคำสั่งเสี่ยงหรือการแก้ไฟล์ที่ป้องกันไว้ และโน้ตที่เพิ่มให้ agent ว่าคนอ่านชอบไทยสั้นๆ ง่ายๆ คำเตือนหลักของ Stop hook คำขอให้เพิ่มเทสต์ และคำขอให้เรียก function ตรงๆ ก็ส่งให้ agent เป็นไทยด้วย เพราะวัดแล้วว่า agent ทำตามได้ใกล้เคียงอังกฤษ (docs/design-notes.md) ส่วนข้อความของ guard คำปฏิเสธคำสั่ง เหตุผลข้างในคำเตือน ไฟล์หลักฐาน และผลของ verify ยังเป็นอังกฤษ เลยไม่มีอะไรขึ้นกับภาษาที่เลือก ค่านี้ hook ที่มากับปลั๊กอินอ่านเอง โปรเจคไม่ต้องรัน `init` ใหม่ ข้อความไทยกินโทเค็นราวสองเท่าของอังกฤษที่ความหมายเท่ากัน จึงให้เปิดเอง

## 2. Guard

ใส่กฎห้ามพลาด 3–5 ข้อใน `.stack-agent/guard.config.json` ทุกข้อต้องมี `message` และ `fix` ที่บอกว่าให้ใช้อะไรแทน เก็บกฎสากล 2 ข้อไว้ ส่วนกฎใน template ที่ไม่ตรงกับโครงสร้าง repo ให้ลบหรือแก้ guard จะเตือน `rule ... matches no files` ให้เห็น

| แบบ | ใช้เมื่อ | ฟิลด์ |
| --- | --- | --- |
| `pattern` | ข้อความที่ห้ามปรากฏในไฟล์บางกลุ่ม ใช้ได้ทุกภาษา | `files`, `pattern`, `flags`, `exclude` |
| `forbidden-import` | ไฟล์ JS/TS หรือ Python กลุ่มหนึ่งห้าม import ไฟล์หรือ package บางตัว | `files`, `to` (glob ของไฟล์ปลายทางที่ import ไปถึงจริง), `toSpecifiers` (glob ของชื่อ package หรือชื่อโมดูลแบบมีจุด) |
| `module-boundary` | โมดูล JS/TS หรือ Python คุยกันได้เฉพาะผ่าน public entry | `modulesRoot`, `publicEntry` |

**`forbidden-import` และ `module-boundary` เข้าใจ import ของ JavaScript, TypeScript และ Python (`.py`)** ถ้าเป็นภาษาอื่นให้ลบออกจาก template แล้วเขียนกฎเดียวกันเป็นแบบ `pattern`

รายละเอียดที่ทำให้กฎไม่ทำงานโดยไม่มีใครรู้:

- pattern เป็น regex ของ JavaScript ไม่ใช่ของ Python หรือ PCRE ไวยากรณ์ที่มีเฉพาะใน Python เช่น `(?P<name>...)` จะ error
- pattern เป็นแบบ multiline เสมอ `^` และ `$` ตรงกับทุกบรรทัด ไม่ใช่แค่ต้นและท้ายไฟล์ ถ้าไม่สนตัวพิมพ์ใหญ่เล็กให้ใส่ `"flags": "i"`
- pattern อยู่ใน JSON จึงต้องเขียน backslash ซ้ำสองตัวเสมอ เช่น regex `\bSELECT\b` ต้องเขียน `"\\bSELECT\\b"` ถ้าเขียน `\b` ตัวเดียวใน JSON จะกลายเป็นตัวอักษร backspace และ guard จะแจ้ง config error
- `files`, `exclude`, `to`, `toSpecifiers`, `publicEntry`, `ignore`, `declinedRules`, `pythonRoots` ต้องเป็น array ของ string ถ้าใส่เป็น string เดี่ยว guard จะแจ้ง config error
- โฟลเดอร์เหล่านี้ถูกข้ามเสมอ: `node_modules`, `.git`, `dist`, `build`, `coverage`, `__pycache__`, `.venv`, `venv`, `.tox`, `.pytest_cache`, `.mypy_cache`, `target`, `.stack-agent/evidence`, `.stack-agent/bin` ถ้าต้องการข้ามเพิ่มให้ใส่ใน `ignore`
- ใน repo ที่เป็น git นั้น guard และแผนที่ API อ่านเฉพาะไฟล์ที่ git จะ commit คือไฟล์ที่ track อยู่ และไฟล์ untracked ที่ไม่ได้ gitignore ไฟล์ `.env` หรือไฟล์ key ที่ gitignore ไว้จะไม่ถูกสแกน เหมือนใน CI ที่ไม่มีไฟล์นั้นอยู่ ข้อนี้ใช้กับไฟล์ที่ระบุด้วย `--files` และกับ hook หลังแก้ไฟล์ด้วย ไฟล์ที่ track อยู่จะถูกสแกนเสมอแม้ pattern ใน gitignore จะตรงกับมัน ถ้าไม่ได้อยู่ใน git จะสแกนทุกไฟล์ใต้ root ไฟล์ที่ระบุทีละไฟล์ (ด้วย `--files` หรือโดย hook หลังแก้ไฟล์และหลังคำสั่ง shell) ก็ข้ามโฟลเดอร์ข้างบนและรายการ `ignore` ของ config เหมือนการสแกนทั้งโปรเจกต์ที่ CI รัน
- ไฟล์ที่ใหญ่เกิน 1 MB จะไม่ถูกตรวจ guard จะแจ้งชื่อแต่ละไฟล์เป็น warning ถ้าตั้งใจให้ข้ามจริงให้ใส่ไว้ใน `ignore`
- `baseline` ใน guard.config.json ใช้ย้ายไฟล์ baseline (ค่าเริ่มต้น `.stack-agent/guard-baseline.json`) นอกจากคำสั่งด้านล่าง `guard.mjs` ยังรับ `--files <paths>` (ตรวจเฉพาะไฟล์เหล่านั้น), `--strict` (ไม่ใช้ baseline และรายงานการผิดกฎทั้งหมด), `--json` และ `--config FILE`
- `to` เทียบกับไฟล์ที่ import ไปถึงจริง เช่น import `../db/index.js` ต้องเขียน `"to": ["src/db/**"]` ถ้าเขียน `"src/db"` จะไม่จับอะไรเลย
- glob รองรับ `*`, `**`, `?` และ `{js,ts}`
- import แบบ path alias (เช่น `@/modules/x`) ต้องตั้ง `"aliases": {"@/": "src/"}`
- กฎ import ข้าม import ที่อยู่ใน comment (และใน Python ข้ามที่อยู่ใน string และ docstring ด้วย)
- Python: อ่านได้ทั้ง `import a.b`, `from a.b import x`, import แบบ relative `from ..pkg import x` และ import หลายบรรทัดในวงเล็บ import แบบ relative หาเทียบกับ package ของไฟล์ที่ import ส่วนแบบ absolute หาใต้ `pythonRoots` (ค่าเริ่มต้น `["."]` และเพิ่ม `"src"` ถ้ามีโฟลเดอร์ `src/`) โดยลอง `<mod>.py` ก่อน แล้วจึง `<mod>/__init__.py` ส่วน `from pkg import name` นับว่า import `pkg/name.py` ถ้าไฟล์นั้นมีอยู่จริง ตัวอย่าง: `"files": ["app/api/**"], "to": ["app/db.py", "app/db/**"]`
- โมดูล Python ที่หาไม่เจอใน repo (third-party) เทียบกับ `toSpecifiers` ด้วยชื่อแบบมีจุด และชื่อ package ตรงกับโมดูลย่อยของมันด้วย เช่น `"toSpecifiers": ["requests"]` จับ `import requests.adapters` ได้
- สำหรับ Python `module-boundary` ใช้ `publicEntry` เริ่มต้นเป็น `["__init__.py"]` โมดูลอื่นจึง import ตัว package ได้ แต่ import ไฟล์ข้างในไม่ได้
- ภาษาอื่นให้เขียนเป็นกฎแบบ `pattern` ที่จับบรรทัด import

```bash
node .stack-agent/bin/guard.mjs --update-baseline
node .stack-agent/bin/guard.mjs
```

คำสั่งแรกบันทึกของเดิมลง `guard-baseline.json` ต่อจากนั้น guard จะ fail เฉพาะเมื่อไฟล์ใดมีจุดผิดกฎเพิ่มขึ้น ratchet นับต่อไฟล์ต่อกฎ ถ้าในไฟล์เดียวกันแก้ของเก่าหนึ่งจุดแล้วเพิ่มของใหม่หนึ่งจุด จำนวนเท่าเดิมจึงผ่าน และถ้าเปลี่ยนชื่อไฟล์ ค่าในชื่อเก่าจะไม่ตามไปด้วย

การลด baseline ทำได้เสมอ แต่ถ้า `--update-baseline` เจอว่าจำนวนใดเพิ่มขึ้น มันจะไม่ยอมเขียนและ exit 1 การเพิ่มต้องใช้ `--allow-increase` ซึ่ง hook จะถามคนก่อน ยกเว้นตอนสร้าง baseline ครั้งแรกที่ยังไม่มีไฟล์

กฎแบบ import (`forbidden-import`, `module-boundary`) นับทีละชื่อที่ import ไม่ใช่ทีละบรรทัด `import { a, b } from "x"` นับเป็น 2 ดังนั้นการเพิ่มชื่อเข้าไปใน import ที่อยู่ใน baseline อยู่แล้วจะ fail ส่วน default import, namespace (`* as ns`), import เพื่อ side effect และ `from x import *` นับเป็น 1 การ destructure จาก `require` และ `await import` นับทีละชื่อ กฎแบบ pattern นับทีละจุดที่ match

baseline ที่เขียนก่อนกฎนี้มี `"version": 1` และนับทีละบรรทัด guard ยังอ่านแบบเดิมได้ และพิมพ์ note บอกให้อัปเกรด ให้รัน `--update-baseline` ตอนที่ไม่มีการแก้ค้าง และแยกเป็น commit ของมันเอง คำสั่งจะเขียน `"version": 2` โดยไม่ต้องใช้ `--allow-increase` ตราบใดที่ไม่มีบรรทัด import เพิ่ม `--compare-ref` ข้ามการอัปเกรดจะเทียบจำนวนบรรทัดกับไฟล์เก่า และแสดงรายชื่อไฟล์ที่ตัวเลขเพิ่มขึ้นตามหน่วยใหม่ให้คนรีวิวตรวจ ถ้า version ของ baseline ลดลง `--compare-ref` จะ fail

**กฎกลาง** โปรเจกต์ใน repository เดียวกัน (monorepo) ใช้กฎร่วมกันได้ โดยเขียนกฎไว้ในไฟล์ JSON ที่มี array `rules` ของตัวเอง แล้วระบุไฟล์นั้นใน config ของแต่ละโปรเจกต์:

```json
{ "extends": ["../../stack-agent-rules.json"], "rules": [] }
```

- path นับจากไฟล์ที่อ้างถึง และไฟล์กลางอ้างไฟล์กลางอื่นต่อได้ ทุกไฟล์ต้องอยู่ใน repository เพื่อให้ checkout ของ CI และ `--compare-ref` อ่านได้
- กฎกลางมาก่อน โปรเจกต์เพิ่มกฎของตัวเองได้ แต่นิยามกฎกลางซ้ำไม่ได้ (guard จะหยุดด้วย config error) การผ่อนกฎกลางจึงต้องแก้ที่ไฟล์กลาง
- `--compare-ref` อ่านไฟล์กลางตามที่เป็นอยู่ที่ commit ฐาน pull request ที่ลบหรือทำให้กฎกลางแคบลงจึง fail แม้ config ของโปรเจกต์ไหนจะไม่เปลี่ยน
- hook จะถามคนก่อนแก้หรือเขียนไฟล์กลางผ่าน shell และควรใส่ไฟล์นี้ไว้ใน CODEOWNERS ด้วย
- แต่ละโปรเจกต์ยังมี baseline ของตัวเอง

ถ้าจะแชร์กฎข้าม repository ให้เก็บกฎของทีมไว้ในไฟล์ JSON ไฟล์เดียว (มี array `rules` ของตัวเอง และไม่มี `extends`) แล้วคัดลอกเข้าไปในแต่ละโปรเจกต์แบบเดียวกับเครื่องมือ:

```bash
node <path-to-Stack_Agent>/scripts/init.mjs . --shared-rules <path>/stack-agent-rules.json
```

คำสั่งนี้คัดลอกไฟล์ไปที่ `.stack-agent/shared-rules.json` และบันทึกที่มาไว้ใน `.stack-agent/shared-rules.source` จากนั้นให้เพิ่ม `"extends": ["shared-rules.json"]` ใน `guard.config.json` (`--check` จะเตือนจนกว่าจะเพิ่ม) การรัน `init` ครั้งต่อ ๆ ไปจะอัปเดตสำเนาจากที่มา และ `--check` จะรายงานสำเนาที่ไม่ตรงกับที่มาว่า `outdated` ถ้าเครื่องนี้อ่านไฟล์ที่มาไม่ได้ (เช่น path ในเครื่องของเพื่อนร่วมทีม) `--check` จะแค่เขียนโน้ตไว้ ให้ commit สำเนานี้ด้วย เพราะ CI อ่านจาก repository และ `--compare-ref` จะ fail pull request ที่สำเนาลบหรือทำให้กฎแคบลง

ข้อยกเว้นรายบรรทัดต้องมีเหตุผล วันหมดอายุ และคนอนุมัติ:

```js
// stack-agent-allow no-sql-in-controller reason="export report, ticket 42" until=2026-12-31 by=lead
```

- comment ที่อยู่บรรทัดของตัวเองใช้กับบรรทัดถัดไป ถ้าต่อท้ายโค้ดจะใช้กับบรรทัดนั้นบรรทัดเดียว
- วันที่ต้องเป็นวันจริงและไม่เกิน `maxAllowDays` (ค่าเริ่มต้น 90 วัน ตั้งได้) และชื่อกฎต้องมีอยู่จริง
- พอเลยวันหมดอายุ guard จะ fail อีกครั้ง
- guard พิสูจน์ไม่ได้ว่า `by=` อนุมัติจริง ส่วนนี้ต้องพึ่งการรีวิว (ดูหัวข้อถัดไป)

CI: `.github/workflows/stack-agent.yml` รัน guard, รัน `guard.mjs --compare-ref origin/<base>` ใน pull request (fail ถ้า baseline โตขึ้น หรือกฎถูกลบ หรือ files, exclude หรือ pattern ของกฎเปลี่ยน guard แยกไม่ออกว่า pattern กว้างขึ้นหรือแคบลง การขยายกฎจึงต้องให้คนตรวจและ merge pull request นั้นเองด้วย) และรันแผนที่ API เมื่อมี `api-map.json` นอกจากนี้มี job `verify` แยกต่างหากที่รัน `node .stack-agent/bin/verify.mjs` ทุก push และ pull request โดยใน pull request จะใส่ `--against origin/<base>` และอัปโหลด `.stack-agent/evidence/` เป็น artifact job นี้ทำให้ `latest.json` ที่ปลอมขึ้นมาไม่มีค่า เปิดไว้เป็นค่าเริ่มต้น และจะแดงจนกว่าจะกรอก `verify.json` ครบและแทนที่ขั้น `EDIT ME: install your dependencies` (`npm ci`, `pip install ...` หรือบล็อก `services:` สำหรับฐานข้อมูล) ซึ่ง `init.mjs --check` จะรายงานขั้นนี้ job จะไม่ถูกข้ามแม้ยังมี placeholder เหลืออยู่ เพราะถ้าข้ามโดยดูจากข้อความ marker pull request ก็ปิดด่านนี้ได้เอง ควรตั้ง `guard` และ `verify` เป็น required status check และใส่ `.github/workflows/` กับ `.stack-agent/` ไว้ใน CODEOWNERS เพราะ pull request ยังแก้ workflow หรือทำให้ `verify.json` หย่อนลงได้ ถ้าใช้ CI ระบบอื่นให้รันคำสั่งเดียวกัน

workflow รันเมื่อมี pull request และเมื่อ push เข้า default branch ของ repository `init` อ่านชื่อ branch นั้นจาก `origin/HEAD` (ซึ่งได้มาตอน clone) แล้วเขียนแทน `main` ใน template repository ที่ push ขึ้นไปเองแทนการ clone จะไม่มี `origin/HEAD` กรณีนี้ถ้ามี `origin/main` หรือ `origin/master` อยู่อย่างใดอย่างหนึ่งเท่านั้น `init` จะเขียน branch นั้นลงไป และ `--check` จะเขียนโน้ตว่าเป็นการเดาไปเรื่อยๆ (อาจมี `origin/main` เก่าค้างอยู่ทั้งที่ default branch ชื่อ `develop`) จนกว่า `git remote set-head origin --auto` จะบันทึก branch จริง ถ้าไม่มีทั้งสองอย่าง (repository ที่ยังไม่มี remote) จะคง `main` ไว้ และ `init.mjs --check` จะเขียนโน้ตว่ายังไม่รู้ชื่อ branch (`git remote set-head origin --auto` บันทึกให้ได้เมื่อมี remote แล้ว) นอกจากนี้ยังเขียนโน้ตเมื่อ `branches` ของ workflow ไม่มี default branch อยู่ด้วย

**Monorepo** GitHub อ่าน workflow จาก `.github/workflows/` ที่ root ของ repository เท่านั้น ถ้าโปรเจกต์อยู่ใน subfolder (`init.mjs services/api`) `init` จะเขียน `.github/workflows/stack-agent-services-api.yml` ไว้ที่ root แทน workflow นี้รันคำสั่งใน `services/api` (`defaults.run.working-directory`) รันเฉพาะเมื่อไฟล์ใน folder นั้นหรือตัว workflow เองเปลี่ยน (`paths`) และอัปโหลด evidence ของ folder นั้น แต่ละโปรเจกต์ใน repository จะได้ workflow ของตัวเอง `init.mjs --check` จะแจ้งถ้ามี `stack-agent.yml` ค้างอยู่ใน subfolder ซึ่ง GitHub ไม่เคยรัน ส่วน `--compare-ref` และขั้น against จะเทียบไฟล์ของโปรเจกต์นั้นเองที่ commit ฐาน

### ป้องกันไม่ให้ guard ถูกปิดเอง

ทางเลี่ยงกฎที่ง่ายที่สุดคือแก้ตัว guard เอง ระบบกันไว้สามชั้น:

1. **ตอนทำงาน:** hook ถามคนก่อนเมื่อ Edit/Write หรือคำสั่ง shell (Bash หรือ PowerShell) จะแก้ `guard.config.json`, `guard-baseline.json`, `.stack-agent/bin/`, `stack-agent.yml` หรือ `stack-agent-<folder>.yml` ของ monorepo (หรือลบโฟลเดอร์ `.github` หรือ `.github/workflows` ส่วนการเพิ่มหรือคัดลอก workflow เข้าไปไม่ต้องถาม) รวมถึง inline script (`node -e`, `node --eval=`, `-pe`, `python -c`, `py -3 -c`, `deno eval`) แม้จะประกอบ path ด้วย `path.join` หรือ `os.path.join` hook ยังปฏิเสธการปิด git hook ด้วย: `--no-verify` ในรูปย่อใดก็ตามที่ git รับ (`--no-verif`), `-c` หรือ `--config-env` ที่ตั้ง `core.hooksPath` การตั้งค่าถาวรด้วย `git config core.hooksPath` การตั้งผ่าน environment (`GIT_CONFIG_PARAMETERS`, `GIT_CONFIG_KEY_<n>`) alias ที่รัน `commit --no-verify` (`-c alias.ci=...` หรือ `git config alias.ci ...`) และ `export HUSKY=0` การแก้ไฟล์ใน `.git/hooks` ก็ถามด้วย ทั้งจาก shell และจาก Edit/Write เพราะ hook ในเครื่องไม่อยู่ใน diff ใดๆ การลบจึงปิดด่านได้โดยไม่มีร่องรอย ส่วน `.husky/` ถูก commit และรีวิวเหมือนไฟล์ทั่วไป จึงไม่ถาม มีข้อยกเว้นหนึ่งข้อเพื่อให้การติดตั้งทำได้โดยไม่มีคนเฝ้า: Edit/Write บน `guard.config.json` หรือ workflow ของ Stack Agent ที่ git ยังไม่เคยเห็น (ยังไม่ stage ยังไม่ commit) และยังมี placeholder `EDIT ME` อยู่ ผ่านได้โดยไม่ถาม เพราะ template ที่ init เพิ่งเขียนยังไม่มีกฎให้ผ่อน เมื่อ placeholder หมดหรือไฟล์ถูก stage หรือ commit แล้ว การแก้จะถามอีกครั้ง และการ commit ครั้งแรกจะถูกรีวิวเหมือนการเปลี่ยนแปลงอื่น
2. **ใน CI:** `--compare-ref` fail เมื่อ baseline โตขึ้น หรือกฎถูกลบหรือขอบเขตของกฎเปลี่ยน (รวมถึงการขยาย เพราะ guard แยกสองกรณีนี้ไม่ออก)
3. **ในการรีวิว:** เพิ่ม `.github/CODEOWNERS` ให้คนที่ระบุต้องอนุมัติทุกการแก้ใน `.stack-agent/` เช่น `/.stack-agent/ @your-org/leads` (init ไม่ได้สร้างให้ เพราะไม่รู้ชื่อทีม)

หลังแก้ไฟล์แต่ละครั้ง hook PostToolUse จะรัน guard กับไฟล์ที่แก้ หลังคำสั่ง shell แต่ละครั้ง (Bash หรือ PowerShell) จะรัน guard กับไฟล์ที่เปลี่ยนนอกเครื่องมือแก้ไฟล์ตั้งแต่การตรวจครั้งก่อน (`sed -i`, codemod, ตัว generate โค้ด) โดยเทียบด้วย git blob id จึงรายงานการผิดกฎแต่ละครั้งเพียงครั้งเดียว ทันทีหลังคำสั่งที่ทำให้เกิด ไฟล์ที่คุณแก้ค้างไว้ก่อนเริ่ม session จะไม่ถูกนับจนกว่าคำสั่งใดจะแก้มัน hook หาโปรเจคโดยมองหา `.stack-agent/guard.config.json` จากโฟลเดอร์ของคำสั่งขึ้นไป ดังนั้นคำสั่งที่รันจากเหนือโปรเจคใน monorepo หรือคำสั่งที่เปลี่ยนไฟล์เกิน 2,000 ไฟล์ จะปล่อยให้ Stop hook ตรวจแทน

ช่องโหว่ที่ยังเหลือ: ส่วน hook ที่ดักคำสั่ง shell ใช้การจับ pattern จึงไม่ครอบคลุมทุกรูปแบบ: path ที่ประกอบจากตัวแปร, interpreter ที่ hook ไม่รู้จัก หรือไฟล์ script ที่รันด้วย `node fix.js` จะผ่านไปได้ CI คือด่านที่ต้องมีเสมอ

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

`--draft` ใส่คอลัมน์ Handler เป็นไฟล์และบรรทัดที่ประกาศ route ให้ชี้ไปที่ไฟล์ handler จริง (เขียนเป็น `path` หรือ `path:line` ก็ได้) แล้วเติม Calls และ Owner จากโค้ด แถวที่ไม่แน่ใจให้คงคำว่า `TODO` ไว้ให้คนตรวจ `--config FILE` อ่าน api-map.json ไฟล์อื่น `--json` พิมพ์ผลเป็นข้อมูล และ `verifyConfig` ใน api-map.json ชี้ไปที่ verify.json ที่อยู่ที่อื่นสำหรับคำเตือนเรื่องการครอบคลุมของเช็ก

คำสั่งที่สอง:

- **fail (exit 1)** เมื่อแผนที่กับโค้ดไม่ตรงกัน: route ในโค้ดไม่มีในแผนที่, แถวในแผนที่ไม่มี route จริง หรือ path ของ handler ไม่มีอยู่จริง
- **เตือนแต่ไม่ fail** เมื่อ endpoint ยังไม่มี verify check หรือแถวยังมี `TODO`

แผนที่เป็นตาราง markdown ที่คอลัมน์แรกเป็น HTTP method และคอลัมน์ที่สองเป็น path ตามที่ regex จับได้ route ที่ mount ใต้ prefix (เช่น `app.use("/items", router)`) จะไม่มี prefix เว้นแต่ regex จะรวมไว้

### Feature map (preset อื่นทั้งหมด)

`init` ให้ preset `generic`, `cli`, `library` และ `frontend-web` มีไฟล์ `.stack-agent/feature-map.md` เป็นตารางของสิ่งที่ผู้ใช้ทำและตำแหน่งในโค้ด ให้ agent อ่านก่อนค้นทั้ง repo (skill `feature-map`)

| คอลัมน์ | เก็บอะไร |
| --- | --- |
| Feature | สิ่งที่ผู้ใช้ทำ |
| Where | ตำแหน่งคั่นด้วยจุลภาค: path ใน repo, `path:line` หรือ `path#text` ซึ่ง text ต้องอยู่ในไฟล์นั้น (selector, flag, label หรือชื่อฟังก์ชัน) |
| How a user reaches it | หน้าจอและการคลิก คำสั่ง หรือการเรียกใช้ของผู้ใช้ library |
| Check | ชื่อ check ใน `verify.json` ที่ทดสอบสิ่งนี้ หรือ `-` |

```bash
node .stack-agent/bin/feature-map.mjs --draft
node .stack-agent/bin/feature-map.mjs
```

`--draft` พิมพ์แถวละหนึ่ง verify check ไว้เป็นจุดเริ่ม ตัวตรวจจะ fail (exit 1) เมื่อไฟล์ใน `Where` หายไป บรรทัดเกินความยาวไฟล์ ข้อความ anchor ไม่อยู่ในไฟล์แล้ว หรือ check ที่อ้างถึงไม่มีใน `verify.json` และจะเตือนเมื่อ feature ไม่มี check หรือยังมีช่อง `TODO` CI จะรันเมื่อมีไฟล์นี้ ควรใช้ `path#text` มากกว่า `path:line` เพราะข้อความเปลี่ยนก็ต่อเมื่อสิ่งที่ผู้ใช้แตะเปลี่ยน โปรเจกต์ที่ติดตั้งไว้ก่อนมี feature map จะไม่ได้ไฟล์นี้เมื่อรัน `init` ซ้ำ ให้เริ่มเองด้วย `--draft` ตัวอย่างที่ไม่ใช่ backend ทั้งสี่มีไฟล์นี้แล้ว `--map FILE` ใช้ตรวจแผนที่ที่เก็บไว้ที่อื่น และ `--json` พิมพ์ผลเป็นข้อมูล

## 4. กฎของทีม และตรวจว่าตั้งค่าครบ

- เติม `.stack-agent/rules.md` ด้วยวิธีเขียนที่ทีมชอบ แล้วเพิ่ม `@.stack-agent/rules.md` ใน `CLAUDE.md` ของ repo ให้ทุก session โหลด
- เติม `.stack-agent/rules-table.md` ให้ทุกกฎห้ามพลาดมีแถว: กฎ, เหตุผล, อะไรบังคับมัน และหลักฐานว่าจับความผิดจริงได้

```bash
node <path-to-Stack_Agent>/scripts/init.mjs . --check
```

exit 0 แปลว่าตั้งค่าครบ ถ้าไม่ใช่จะบอกว่ายังเหลืออะไร

`--check` ยังเทียบทุกไฟล์ใน `.stack-agent/bin/` กับไฟล์ปัจจุบันของ plugin ไฟล์ที่ต่างไปหรือหายไปจะขึ้นเป็น `outdated: .stack-agent/bin/<file>` และนับว่ายังตั้งค่าไม่ครบ (exit 1) แปลว่า guard หรือ verify ที่คัดลอกไว้เก่ากว่า plugin และอาจยังไม่มีการแก้บั๊กล่าสุด ให้อัปเดตด้วยการรัน `node <path-to-Stack_Agent>/scripts/init.mjs .` ซ้ำ คำสั่งนี้เขียนทับเฉพาะเครื่องมือ ไม่แตะ config ของคุณ ส่วน `.stack-agent/bin/VERSION` บอกว่าเครื่องมือมาจาก plugin เวอร์ชันไหน ไฟล์นี้เปลี่ยนทุกรุ่น ถ้า VERSION ต่างอย่างเดียวจะไม่รายงาน และจะแสดงก็ต่อเมื่อมีเครื่องมือที่ต่างด้วย

hook รัน script ของ plugin เอง ส่วน CI รันชุดที่คัดลอกไว้ใน `.stack-agent/bin/` ถ้าชุดที่คัดลอกไว้เก่า ทั้งสองจึงอาจตัดสินโค้ดเดียวกันต่างกัน SessionStart hook จึงเทียบแบบเดียวกันทุก session และถ้ามีไฟล์ที่ต่างกัน จะบอกคุณว่าเป็นไฟล์ไหน พร้อมคำสั่งที่ใช้อัปเดต (บอกคุณ ไม่ได้บอก agent จึงไม่มีอะไรถูกเขียนทับโดยที่คุณไม่รู้) หลักฐานยังบันทึกเวอร์ชันของวิธีคำนวณ fingerprint (`fingerprintVersion`) ด้วย ถ้า `verify.mjs` ที่คัดลอกไว้คำนวณต่างจาก hook Stop hook จะบอกตามนั้น แทนการบอกว่าโค้ดเปลี่ยน

นอกจากนี้ยังแจ้งกฎที่ทุก preset มี (`no-merge-conflict-markers`, `no-private-keys`, `no-debug-tags`) แต่ guard config ของคุณไม่มี พร้อมบอกไฟล์ preset ที่ให้คัดลอก การแจ้งนี้ไม่เปลี่ยน exit code เพราะการไม่ใช้กฎบางข้ออาจเป็นการตัดสินใจ ถ้าตั้งใจไม่ใช้ ให้ใส่ id ของกฎใน `"declinedRules"` ใน `guard.config.json` แล้วการแจ้งจะหยุด

## 5. Skills

- `verify` ใช้ได้กับทุกโปรเจค
- สำหรับ backend มี `add-endpoint`, `add-migration` และ `api-map`
- เพิ่ม skill ของงานที่ทีมทำบ่อยที่สุด 2–3 อย่างใน `.claude/skills/<name>/SKILL.md` ถ้า agent ต้องเขียนโค้ดเดิมซ้ำ ให้เก็บเป็น script ไว้ในโฟลเดอร์ของ skill
- จบงานใหญ่แล้วใช้ `/stack-agent:reflect` เพื่อให้เสนอการแก้ skill จากสิ่งที่พลาด คุณต้องอนุมัติก่อนแก้
- `/stack-agent:mine-corrections` ทำแบบเดียวกันแต่ข้ามหลาย session: `scripts/mine-transcripts.mjs` อ่าน transcript ที่ Claude Code เก็บไว้ของโปรเจกต์นี้ในเครื่องคุณ (อ่านอย่างเดียว ไม่ส่งอะไรออกไป) แสดงสิ่งที่คุณพิมพ์หลังคำตอบของ agent แล้ว skill จะจัดกลุ่มการแก้ที่เกิดซ้ำอย่างน้อยสอง session และเสนอ check การแก้ skill หรือกฎให้แต่ละกลุ่ม พร้อมยกข้อความเป็นหลักฐาน คุณต้องอนุมัติก่อนแก้ ก่อนพิมพ์อะไรออกมา สคริปต์จะแทนคีย์ โทเค็น รหัสผ่าน private key เลขบัตรเครดิต เลขบัตรประชาชน และอีเมลที่มันรู้จักด้วย `[REDACTED:...]` และบอกว่าซ่อนไปกี่ตัว รหัสลับที่เคยวางในแชตเก่าจึงไม่ไปถึง model หรือไฟล์ใน repo รูปแบบที่มันไม่รู้จักยังหลุดได้
- `node <path-to-Stack_Agent>/scripts/skill-usage.mjs` นับจาก transcript ชุดเดียวกันว่า skill ไหนถูกโหลด ถูกสั่งด้วย slash command หรือแค่ถูกเปิดอ่านใน 30 วันที่ผ่านมา (`--days N`, `--worktrees`, `--skills DIR` สำหรับโฟลเดอร์เพิ่ม, `--json`) มันแสดงรายการ skill ที่ไม่มีใครใช้ ถ้ามีไม่ถึง 10 session (`--min-sessions N`) จะเขียนว่า "not used so far" และบอกว่าน้อยเกินจะสรุปว่าไม่มีใครใช้ session ที่ resume มาจะมีประวัติเดิมซ้ำอยู่ด้วย จึงนับแต่ละเหตุการณ์ครั้งเดียว และไฟล์ที่เป็นแค่สำเนาไม่นับเป็นอีก session ส่วน skill ชื่อเดียวกันจากสอง plugin นับเป็นตัวเดียว มันไม่ลบหรือย้าย skill ใดเลย skill ที่เก็บไว้ทำงานนานๆ ครั้งอาจถูกต้องแล้ว
- เมื่อต้องแก้ agent เรื่องเดิมซ้ำสองครั้ง ใช้ `/stack-agent:correct` เปลี่ยนเป็นกฎ guard พร้อมพิสูจน์ว่ากฎจับได้จริง
- `/stack-agent:sample-review` สุ่มตรวจ commit ล่าสุด แล้วส่งปัญหาที่เจอซ้ำไปให้ `correct`
- `/stack-agent:debug` แก้บั๊กโดยทำให้บั๊กโผล่ได้ตามสั่งก่อน: repro กลายเป็น check ของ verify หรือเทส ขั้น against จึงพิสูจน์ได้ว่ามัน fail กับโค้ดก่อนแก้ บรรทัด debug ติด tag `[DEBUG-xxxx]` และกฎ guard `no-debug-tags` (มีในทุก preset ยกเว้นไฟล์ Markdown, log และ build output) จะ fail ถ้ามีบรรทัดค้างอยู่ตอนรัน guard หรือ CI กฎนี้ตั้ง `"onEdit": "skip"` ไว้ hook หลังแก้ไฟล์จึงไม่ขวางตอน agent ใส่บรรทัด debug ระหว่างทำงาน กฎอื่นก็ใช้ option นี้ได้ โปรเจคที่ตั้งค่าก่อนมีกฎนี้จะไม่ได้กฎนี้ เพราะ `init` ไม่เขียนทับ guard config ที่มีอยู่ แต่ `init.mjs --check` จะแจ้งให้ (ดูหัวข้อ 4)

### สุ่มตรวจ: ผลรีวิวเป็นข้อมูล และมี agent ตัวที่สองตรวจซ้ำ

`sample-review` รีวิวแต่ละ commit ที่สุ่มได้ใน checkout ของ commit นั้น (`review-worktree.mjs add <sha>`) เพราะ Read, Grep และ Glob เห็นแค่ไฟล์บนดิสก์ ถ้ารีวิวใน working tree หลัก ทุก `path:line` จะชี้ไปที่โค้ดของวันนี้ checkout นี้เป็น git worktree ชั่วคราว ปิด hook และลิงก์ `node_modules` เข้ามา แล้วลบทิ้งตอนจบ

agent `reviewer` รายงานเป็น candidate ไม่ใช่คำตัดสิน ในรูป JSON array แต่ละรายการระบุ `source` (`guard:<rule-id>`, `api-map`, `verify-evidence`, `rules.md:<line>`, `standards:<file>:<line>`, `correctness` หรือ `spec`) ตำแหน่ง และหลักฐาน ทุกตำแหน่งและหลักฐานต้องยกโค้ดที่ชี้มาด้วย นอกจาก `rules.md` แล้ว reviewer ยังอ่านมาตรฐานที่ repo เขียนไว้เอง (`CONTRIBUTING.md`, `CODING_STANDARDS.md`, `STYLEGUIDE.md`, `STYLE.md`, `AGENTS.md`, `CLAUDE.md` ในโฟลเดอร์ที่ change แตะหรือโฟลเดอร์แม่) และอ้างข้อที่ถูกละเมิดเป็น `standards:<file>:<line>` ถ้าไฟล์เหล่านี้ขัดกับ `rules.md` ให้ยึด `rules.md` agent `finding-verifier` อีกตัวได้แค่ข้อกล่าวหากับตำแหน่ง ไม่ได้หลักฐานของ reviewer พยายามหักล้างทีละข้อ แล้วตัดสินว่า:

- `confirmed`: พร้อม `severity` (`blocking` หรือ `non-blocking`), `kind` (`repeatable` ส่งต่อให้ `/stack-agent:correct` ส่วน `one-off` ไม่ส่ง), สิ่งที่ `observed` และ `fix`
- `hardening`: ถ้าไม่มีอะไรกันไว้จะเป็นปัญหาจริง แต่มีอีกชั้นในโค้ดกันไว้แล้ว (validation ที่ขอบ, กฎ guard, constraint ของฐานข้อมูล) บันทึก `control` กับ `suggestion` และรายงานแยกจากปัญหา ข้อเสนอเสริมความแข็งแรงจึงไม่ไปปนกับรายการของที่พังจริง
- `needs_validation`: เฉพาะเมื่อตัดสินได้จากข้อเท็จจริงที่โค้ดบอกไม่ได้ พร้อม `blockers` และ `how_to_check`
- `rejected`: พร้อม `reason`

finding แบบ `spec` เทียบการเปลี่ยนแปลงกับสิ่งที่ถูกสั่งให้ทำ แยกจากกฎของทีม: requirement ที่ขาด, พฤติกรรมที่ไม่มีใครสั่ง หรือ requirement ที่ทำผิด โดยยกคำสั่งมาใน `spec: { from, quote }` ซึ่ง `from` เป็น `commit-message` (sample-review ส่ง message ของแต่ละ commit ให้) หรือไฟล์ที่เก็บคำสั่ง (ถ้ารีวิวงานที่กำลังทำ skill จะบันทึกคำขอของผู้ใช้เป็น `spec.md` ในโฟลเดอร์ของรอบนั้น) และ validator ตรวจว่าข้อความที่ยกมามีอยู่จริง commit message ที่บอกแค่ชื่องาน ("fix bug") ไม่มีอะไรให้เทียบ reviewer จึงข้ามการตรวจ spec

review log ยังเป็น ledger ของการสุ่มรอบถัดไปด้วย: `sample-commits.mjs` จะข้าม commit ที่ log บันทึกว่ารีวิวแล้ว (แถวที่ action ขึ้นต้นด้วย `not reviewed` ไม่นับ) และเลือก commit ที่แตะไฟล์ที่ยังไม่เคยมี commit ที่รีวิวแล้วแตะก่อน commit อื่น ถ้าใส่ `--no-ledger` จะสุ่มล้วนแบบเดิม commit ที่ finding ยังต้องรอตรวจสอบนับว่ารีวิวแล้ว เพราะรีวิวเกิดขึ้นแล้ว และคำถามที่ค้างอยู่ก็อยู่ใน log commit ที่แค่เพิ่มแถวใน log จะไม่ถูกสุ่มเลย และเมื่อเปิด ledger อยู่ `--seed` จะได้ชุดเดิมก็ต่อเมื่อ log ยังไม่เปลี่ยน ไฟล์จะนับว่ารีวิวแล้วทันทีที่มี commit ที่รีวิวแล้วแตะมัน ไฟล์ที่รีวิวไปนานแล้วและแก้ไปเยอะตั้งแต่นั้นจึงยังนับว่ารีวิวแล้ว

agent ทั้งสองตัวรัน git แบบ `git -C "<review root>" ...` และส่ง `--root` ให้ check ของ Stack Agent แทนการเปลี่ยน directory เพราะกฎ permission ปฏิเสธ `cd` ที่นำหน้าคำสั่ง git ถ้าอ่าน diff ไม่ได้ reviewer จะหยุดโดยไม่มี candidate (log ว่า commit นั้นไม่ได้รีวิว) ส่วน verifier ก็หยุดด้วย candidate ของมันจึงถูกบันทึกเป็น `needs_validation` ไฟล์ที่ commit ลบไปให้อ้างตามที่เป็นก่อน commit นั้น validator จะอ่านจาก parent ของ commit

candidate จาก guard และ API map ไม่ส่งให้ verifier แต่ skill รัน check นั้นซ้ำเองแล้วบันทึก `verified_by: "script:<command>"` คนตั้ง `found_by` กับ `verified_by` คือ skill ไม่ใช่ agent ส่งให้ verifier ได้ไม่เกิน 8 รายการต่อรอบ ที่เหลือเป็น `needs_validation`

`review-findings.mjs validate` ตรวจทุกไฟล์ก่อนใช้: ฟิลด์ที่แต่ละคำตัดสินต้องมีหรือห้ามมี, id ไม่ซ้ำ, คนเจอไม่ได้ตรวจของตัวเอง, ใช้ script เป็นผู้ตรวจได้เฉพาะ finding จาก guard, API map หรือ evidence, กฎ guard บรรทัดใน `rules.md` และบรรทัดในไฟล์มาตรฐานที่อ้างมีอยู่จริง (และ source แบบ standards ต้องชี้ไปที่ไฟล์ในรายชื่อข้างบน) โค้ดที่ยกมาต้องอยู่ภายใน 3 บรรทัดจากบรรทัดที่อ้างใน commit ที่รีวิว (`--root <checkout>` หรือ `--ref <commit>`), finding ของ commit ใดต้องอ้าง (ในตำแหน่งหรือหลักฐานอย่างน้อยหนึ่งรายการ) ไฟล์ที่ commit นั้นแก้ จะได้ไม่โยนปัญหาที่มีอยู่ก่อนแล้วให้ commit ที่กำลังรีวิว และถ้าใส่ `--candidates` ก็ตรวจว่าไม่มี candidate ไหนหายไประหว่างทาง มันพิสูจน์แค่รูปแบบกับการอ้างอิงโค้ด ไม่ได้พิสูจน์ว่า finding ถูก `review-findings.mjs rows` แปลงไฟล์สุดท้ายเป็นแถวใน review log ไฟล์เหล่านี้อยู่ใน `.stack-agent/evidence/review/<date>-<seed>/` ซึ่ง gitignore ไว้พร้อม evidence อื่น ส่วน `.stack-agent/review-log.md` คือบันทึกที่ commit `--stage candidates` ใช้ตรวจ candidate ของผู้รีวิวก่อนส่งให้ผู้ตรวจยืนยัน (stage ค่าเริ่มต้นคือ `final`) และ `rows` ต้องมี `--date YYYY-MM-DD` เป็นวันที่ของแถวที่สร้าง

สำหรับงานที่กำลังทำอยู่ reviewer จะรัน `node .stack-agent/bin/verify.mjs --evidence-status` ด้วย ซึ่งบอกว่า evidence ล่าสุดเป็นการรันครบที่ผ่านสำหรับโค้ดตอนนี้หรือไม่ โดยไม่รันอะไรเลย โปรเจคที่ตั้งค่าก่อนมี flag นี้ต้องอัปเดตเครื่องมือที่ vendor ไว้: รัน `node <path-to-Stack_Agent>/scripts/init.mjs .` อีกครั้ง (`init.mjs --check` จะแจ้ง `.stack-agent/bin/verify.mjs` ว่า outdated จนกว่าจะทำ)

## 6. Evals

ทำเมื่อมี skill ให้วัดแล้ว ดู `/stack-agent:run-evals` ควรมีอย่างน้อย 1 case ต่อ skill และให้ดูส่วนต่างระหว่างมีกับไม่มี plugin ไม่ใช่ดูแค่คะแนน

## ที่ตั้งใจไม่ใส่

ไม่มี auto-merge และไม่มี outer loop ที่ดึงงานจาก Slack หรือ issue tracker ให้เริ่มจาก agent ทำงานแล้วคนรีวิว โดยใช้ agent `reviewer` ตรวจรอบแรก แล้วค่อยเพิ่มความอิสระเมื่อ verification กับ guard พิสูจน์ตัวเองแล้ว
