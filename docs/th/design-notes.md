# บันทึกการออกแบบ

แนวคิดมาจากไหน แต่ละแนวคิดกลายเป็นไฟล์อะไร อะไรที่ตั้งใจไม่ทำ และอะไรที่ตรวจแล้วหรือยังไม่ได้ตรวจ

[English](../design-notes.md)

## ที่มา

Stack Agent เริ่มจากบันทึกสรุปทอล์ก 3 อัน:

- Lauren Tan (ผู้สร้าง [pstack](https://github.com/cursor/plugins/tree/main/pstack)) เล่าว่าทำอย่างไรจนไว้ใจให้ agent merge PR เองได้ โดยคนแค่สุ่มตรวจ: เริ่มจาก verification, ย้ายกฎไปไว้ใน lint และ CI แทน prompt และใช้ eval ทดสอบ skill
- ทอล์กอีกอันของ Lauren Tan ที่ลงรายละเอียดเรื่องการคุมเบราว์เซอร์, eval playbook และกฎสถาปัตยกรรม "Dune"
- สรุปของ Austin Marchese เรื่องวิธีที่วิศวกร Anthropic เขียน skill ใน Claude Code: เล็ก ต่อกันได้ มี script และดีขึ้นทุกครั้งที่ใช้

แก่นร่วมกันคือ ย้ายความรู้ออกจากหัวคนและจาก prompt ไปไว้ในโครงสร้างที่ fail ให้เห็นชัด จนไว้ใจให้ agent ทำงานเองได้

## แนวคิด → สิ่งที่ทำ

| แนวคิด | ทำเป็น | ตรวจโดย |
| --- | --- | --- |
| Verification: agent ต้องพิสูจน์ว่าโปรแกรมทำงานจริง | `scripts/verify.mjs` (เทส, server, HTTP check, command check, หลักฐาน) และ skill `verify` | `tests/verify.test.mjs`, `tests/verify-command.test.mjs`, `tests/verify-args.test.mjs` และตัวอย่างทั้งห้าผ่าน verify แบบเต็ม |
| Close the loop: เช็กผลเองใน session เดียวกัน | หลักฐานใน `.stack-agent/evidence/latest.json` (บันทึกว่ารันเต็มหรือบางส่วน และ fingerprint ของโค้ดที่ทดสอบ) และ Stop hook `stop-verify.mjs` ที่บล็อกจนกว่าหลักฐานจะตรงกับโค้ด มีทางออกด้วย `--skip` ที่บันทึกเหตุผล และปล่อยหลังบล็อก 3 ครั้ง | `tests/hooks.test.mjs`, `tests/stop-hook.test.mjs`, `tests/stop-block.test.mjs`, `tests/fingerprint.test.mjs` |
| check ต้องทดสอบการแก้จริง ไม่ใช่แค่ผ่าน | ขั้น `against` ใน `verify.mjs`: เอา check ใหม่ไปรันกับโค้ดก่อนแก้ และต้องมีอย่างน้อยหนึ่งตัวที่ fail | `tests/verify-against.test.mjs` |
| Feature map: ฟีเจอร์ไหนอยู่ตรงไหน | `scripts/api-map.mjs` สำหรับ HTTP backend พร้อมตรวจ drift | `tests/api-map.test.mjs` และ eval ที่รันจริง (ด้านล่าง) |
| Hard constraint อยู่ใน lint/CI ไม่ใช่ prompt | `scripts/guard.mjs` และ `templates/ci/stack-agent.yml` | `tests/guard.test.mjs`, `tests/presets.test.mjs` |
| ทางที่ขี้เกียจที่สุดต้องเป็นทางที่ถูก | ทุกกฎต้องมี `fix` และ hook PostToolUse ส่ง fix ให้ agent ทันทีหลังแก้ไฟล์ | เทสของ config และ hook |
| เปลี่ยน comment ที่เตือนซ้ำให้เป็นกฎ | skill `correct` (ไล่จาก architecture → types → guard → test → docs) | ขั้นตอนใน skill |
| Ratchet สำหรับ repo ที่ใช้ร่วมกัน | baseline, `--allow-increase`, `--compare-ref` | เทส ratchet และ compare-ref |
| สุ่มตรวจแทนการรีวิวทุก PR | `scripts/sample-commits.mjs`, skill `sample-review` และ agent `reviewer` | `tests/sample-commits.test.mjs` |
| Eval คือ unit test ของ skill ตรวจแบบ blind โดยโมเดลอื่น | `evals/` ตามรูปแบบ `claude plugin eval` (เทียบมี/ไม่มี plugin, judge เป็น haiku โดยค่าเริ่มต้น), agent `judge`, skill `run-evals` | รันจริง 1 case (ด้านล่าง) |
| งานที่ผลตายตัวเป็น script งานที่ต้องคิดให้ agent | script ไม่มี dependency สำหรับทุกขั้นที่ทำซ้ำ | 216 เทส |
| Skill เล็ก ต่อกันได้ มี script และดีขึ้นทุกครั้ง | 9 skills และ `reflect` สำหรับปรับปรุง | `claude plugin validate --strict` |
| คุมว่าใครเรียก skill ได้ | `disable-model-invocation: true` สำหรับ skill ที่เขียนไฟล์หลายจุดหรือใช้เงิน | frontmatter ของ skill |
| ชั้นระหว่าง prompt กับ CI ตอนทำงาน | `hooks/hooks.json`: PreToolUse (คำสั่ง shell และการแก้ไฟล์ของ guard), PostToolUse, Stop | `tests/hooks.test.mjs` |

## ที่ตั้งใจไม่ทำ

- **Auto-merge และ outer loop** (ดึงงานจาก Slack หรือ tracker): ควรเพิ่มหลังจาก verification กับ guard มีผลงานใน repo ของคุณแล้ว
- **การคุมเบราว์เซอร์ (Control Glass):** ให้ใช้ตัวรัน e2e ของโปรเจคเป็น command check (preset `frontend-web`) เพราะตัวคุมเบราว์เซอร์ในตัวจะเพิ่ม dependency หนัก
- **Cloud agent (Benny):** ต้องใช้ Cursor Automations ซึ่ง Claude Code ไม่มี
- **กฎเฉพาะ codebase จากทอล์ก** (ห้าม `useEffect`, ห้าม code comment): เป็นกฎของ codebase เดียว ถ้าต้องการให้เขียนเป็นกฎแบบ `pattern`

## ข้อจำกัดที่รู้อยู่

- กฎที่อ่าน import รองรับ JS/TS และ Python ภาษาอื่นใช้กฎแบบ `pattern` การหาโมดูล Python เป็นแบบ static ไม่ตามการแก้ `sys.path`, การเรียก `importlib` หรือ package ที่ติดตั้งไว้ โมดูลที่หาไม่เจอใน repo จึงถือเป็น third-party
- hook ที่ดักคำสั่ง shell ใช้การจับ pattern ถ้าตั้งใจเลี่ยง (เช่นใช้ alias หรือ script ที่เขียนไฟล์โดยไม่ระบุชื่อไฟล์ในคำสั่ง) อาจหลุดได้ CI ที่มี `--compare-ref` และ CODEOWNERS คือด่านที่ไม่มีทางหลุด
- guard ใน PostToolUse ตรวจการแก้ผ่าน Edit/Write ส่วนการแก้ผ่าน shell จะถูกจับโดย CI และ Stop hook
- หลักฐานและไฟล์ skip เป็นไฟล์ธรรมดา การแก้ด้วย Edit/Write จะถามคนก่อน แต่ถ้าตั้งใจเขียนผ่าน shell ก็ยังปลอมได้ CI ที่รัน verify ซ้ำคือด่านที่ปลอมไม่ได้
- ขั้น `against` พิสูจน์ได้ว่ามี check ใหม่อย่างน้อยหนึ่งตัวที่แยกโค้ดเก่ากับโค้ดใหม่ออกจากกัน แต่บอกไม่ได้ว่า check ครอบคลุมทุกอย่างที่การแก้ควรทำ และผลที่เชื่อไม่ได้ (server ของโค้ดเก่าเปิดไม่ขึ้น) จะข้ามขั้นนี้แทนที่จะให้ผ่าน
- ratchet นับต่อไฟล์ต่อกฎ กฎแบบ import นับทีละชื่อที่ import (baseline version 2) version 1 นับทีละบรรทัด การเพิ่มชื่อเข้าไปใน import ต้องห้ามที่มีอยู่แล้วจึงผ่านได้ ช่องโหว่นี้เจอระหว่างวางแผนงาน A/B และปิดแล้วพร้อมเทสกันถอยหลัง (`tests/guard-widening.test.mjs`)
- judge แบบ LLM ใน Claude Code เลือกได้เฉพาะโมเดล Claude คำว่า "คนละโมเดล" จึงหมายถึงโมเดล Claude อีกตัว

## สถานะการตรวจสอบ

| สิ่งที่ตรวจ | สถานะ |
| --- | --- |
| Unit และ integration test | ผ่าน 216 เทสบน Windows 11 กับ Node 25 |
| ตัวอย่างทั้งห้า หนึ่งตัวต่อ preset (Node API, Python CLI, library, frontend, script ประมวลผลข้อมูล) | ผ่าน guard และ verify แบบเต็ม และ verify fail เมื่อจงใจทำให้พฤติกรรมเสีย (`tests/sample-presets.test.mjs`, `tests/sample-cli.test.mjs`) |
| Mutation check (จงใจใส่บั๊ก 14 จุด) | เทสจับได้ครบ |
| `claude plugin validate --strict` | ผ่าน |
| Eval `api-map-lookup` (อ่านอย่างเดียว) | รันจริง 2 ครั้ง: มี plugin 1.0, ไม่มี 0.5, ส่วนต่าง +0.5 ทั้งสองแบบตอบถูก ที่ต่างคือแบบมี plugin อ่านแผนที่ก่อน |
| Eval ที่ใช้ Bash (`add-endpoint-delete-item`, `verify-before-done`, `add-migration-column`) | โหลดได้ถูกต้อง แต่ยังไม่ได้รัน เพราะต้องใช้ Linux, macOS หรือ WSL2 |
| CI บน Linux และ Windows ด้วย Node 22/24 | ตั้งค่าแล้ว ยังไม่ได้รัน |
| Hook ใน session Claude Code จริง | ยืนยันแล้วด้วยการรันจริงแบบ headless (`claude -p --plugin-dir`, Claude Code 2.1.300, haiku, รวม $0.05): การปฏิเสธ `--no-verify`, การถามก่อนแก้ guard baseline, guard หลังแก้ไฟล์ และการเตือนตอน Stop ทำงานครบ และการเตือนไม่เด้งซ้ำในครั้งที่สอง |
| ความเร็วของ guard ตอนสแกนทั้ง repo | หลัง cache regex ของ glob และตัดการเช็กไฟล์ที่ซ้ำ: repo สังเคราะห์ที่ไม่มี import ขนาด 1k/5k/20k ไฟล์ จาก 1,535→180 ms, 2,872→639 ms, 16,698→2,239 ms ส่วน repo ที่มี import เยอะ (`scripts/bench-guard.mjs`) เร็วขึ้น 13–17% จากนั้นให้หาไฟล์ปลายทางของแต่ละ import บนดิสก์แค่ครั้งเดียวต่อการรัน แทนที่จะหาทุกครั้งที่เจอ import: repo ที่มี import เยอะขนาด 1k/5k ไฟล์ ค่ามัธยฐาน 566→254 ms และ 2,859→1,312 ms (ราว 2.2 เท่า เครื่องที่วัดมีโหลดแกว่ง รอบที่เร็วที่สุด 511→213 และ 1,775→860 ms) ผลลัพธ์เหมือนเดิมทุกไบต์ทุกขั้น การรันซ้ำแยกต่างหากภายหลังบนเครื่องที่มีงานอื่นแย่ง CPU ผลแกว่งเกินกว่าจะยืนยันอัตราที่แน่นอนได้ (เร็วขึ้น 3 ใน 4 ครั้ง ราว 1.7–3 เท่า และช้าลง 1 ครั้ง) จึงให้ถือเป็นตัวเลขโดยประมาณ ส่วนผลลัพธ์ตรงกันทุกไบต์ทุกครั้ง |

## ทดสอบ A/B กับ agent จริง (19 ต.ค. 2026)

unit test พิสูจน์ว่าเครื่องมือทำงานได้ การทดสอบนี้ตอบอีกคำถามหนึ่ง คือ plugin ทำให้ agent จริงทำงานต่างไปหรือไม่

harness ที่ใช้ในการทดสอบนี้เก็บและดูแลอยู่ที่ `scripts/ab/` ดูวิธีรันซ้ำใน [วัดพฤติกรรมของ agent (A/B)](customizing.md#วัดพฤติกรรมของ-agent-ab)

**วิธีทดสอบ:** รัน `claude -p` แบบ headless (Claude Code 2.1.300, Sonnet, จำกัดรันละไม่เกิน $1) เทียบแบบใส่ `--plugin-dir` กับไม่ใส่ แต่ละรันได้สำเนาใหม่ของ `examples/sample-backend` ที่รัน `init.mjs` แล้ว ทั้งสองแบบจึงมีไฟล์ `.stack-agent/` เหมือนกัน สิทธิ์ที่ให้คือ `acceptEdits` กับ Read/Glob/Grep/Edit/Write และคำสั่ง `node`/`npm` การให้คะแนนทำด้วย script หลังจบแต่ละรัน ไม่ใช้สิ่งที่ agent สรุปเอง ได้แก่ ยิง HTTP ตรวจเอง (script เปิด server และเรียก endpoint เอง), รันเทส, guard, แผนที่ API, มีไฟล์หลักฐาน verify แบบเต็มที่ใหม่กว่าการแก้โค้ดหรือไม่ และ `verify.json` มี check ใหม่ที่ทดสอบกฎใหม่หรือไม่ แล้ว parse transcript ดูว่า skill และ hook ตัวไหนมีส่วน

**งานที่ 1: เพิ่ม `DELETE /items/:id`** (prompt บอกให้ทำให้แน่ใจว่าใช้ได้จริง) ทำแบบละ 2 รัน

| | มี plugin | ไม่มี |
| --- | --- | --- |
| ทำงานถูก, เทสผ่าน, guard ผ่าน, อัปเดตแผนที่ | 2/2 | 2/2 |
| มีหลักฐาน verify แบบเต็มที่ใหม่ | 2/2 | 2/2 |
| ค่าใช้จ่ายต่อรัน | ราว $0.41 | ราว $0.41 |

ไม่ต่างกันเลย ทั้งสองแบบหาไฟล์ใน `.stack-agent/` (กฎ, แผนที่, config ของ verify) เจอเองจากการอ่าน repo ในงานที่สั่งไว้ชัดเจน ไฟล์ใน repo ทำหน้าที่หลัก และ plugin ไม่ได้เพิ่มอะไรที่วัดได้

**งานที่ 2: ปฏิเสธชื่อ item ที่ยาวเกิน 50 ตัวอักษร** (prompt ไม่ได้ขอให้ verify)

| | ไม่มี plugin | plugin, Stop hook เดิม | plugin, Stop hook ใหม่ |
| --- | --- | --- | --- |
| จำนวนรัน | 3 | 6 | 7 |
| ทำงานถูก (ยิงตรวจเอง) | 3/3 | 6/6 | 7/7 |
| มีหลักฐาน verify แบบเต็มที่ใหม่ | 0/3 | 6/6 | 7/7 |
| `verify.json` มี check ที่ทดสอบกฎ 50 ตัวอักษร | 0/3 | 1/6 | 7/7 |
| ค่าใช้จ่ายต่อรัน | $0.25–0.27 | $0.27–0.38 | $0.28–0.33 |

- **Stop hook คือสิ่งที่ทำให้ agent verify:** แบบมี plugin มีหลักฐานทุกครั้ง แบบไม่มีไม่มีเลย hook ทำงาน 13 จาก 15 รันที่มี plugin (อีก 2 รัน agent verify ไปก่อนแล้ว) ส่วน skill ถูกเรียกแค่ 1 จาก 15 รัน พฤติกรรมนี้จึงไม่ได้มาจาก skill
- **hook เดิมปล่อยหลักฐานที่ไม่ได้ทดสอบของใหม่ผ่านไป:** agent รัน check เดิมซ้ำซึ่งผ่านโดยไม่ได้ทดสอบกฎใหม่เลย hook ใหม่จึงเพิ่มประโยคเมื่อ `verify.json` ไม่มีการเปลี่ยน ว่าให้เพิ่ม check สำหรับพฤติกรรมใหม่ ทั้งกรณีสำเร็จและกรณีถูกปฏิเสธ
- **ผลของ hook ใหม่แยกได้ดังนี้:** 4 จาก 7 รัน agent เพิ่ม check เองก่อนหยุด ประโยคใหม่จึงไม่ได้แสดง อีก 3 รัน ประโยคแสดงก่อนที่จะมีการแก้ `verify.json` และ agent ทั้ง 3 รันเพิ่มทั้ง check ที่รับ 50 ตัวอักษรและที่ปฏิเสธ 51 ตัวอักษร ประโยคจึงได้ผล 3 จาก 3 ครั้งที่แสดง การรันซ้ำแบบตัดตัวแปร (ablation) ด้วย hook เดิมได้ 1/3 ยืนยันว่าการเพิ่ม check เองแกว่งไปมาในแต่ละรัน

**ข้อจำกัด:** จำนวนรันน้อย (2–7 รันต่อช่อง) ให้ถือเป็นแนวโน้ม ไม่ใช่สถิติ ทดสอบโมเดลเดียว แอปตัวอย่างเล็กมาก ความถูกต้องจึงเต็มทุกแบบ plugin อื่นที่ผู้ใช้ติดตั้งไว้ถูกโหลดในทั้งสองแบบ รันต่อเนื่องกันบนเครื่องเดียว และใช้เงินรวมราว $6.30

## บันทึกการตรวจงานตัวเอง

หลังสร้างรอบแรก มีผู้ตรวจอิสระสองคน คนแรกหาบั๊กและทางเลี่ยง ส่วนอีกคนลองติดตั้งกับโปรเจคใหม่ตามเอกสาร ทั้งสองเจอปัญหาจริงประมาณ 15 ข้อ แก้แล้วทั้งหมด และทุกข้อมีเทสกันไม่ให้กลับมา ข้อหลักๆ คือ:

- agent ผ่อนกฎได้ด้วยการแก้ config หรือ baseline ตรงๆ แก้ด้วย hook ป้องกัน path, `--compare-ref` ใน CI และคำแนะนำเรื่อง CODEOWNERS
- คำสั่งเลี่ยงหลุดผ่าน (`git --no-pager commit --no-verify`, `HUSKY=0`, `core.hooksPath`, `bash -c "..."`, `push --mirror`, `checkout .`) จึงเขียนตัวแยกคำสั่งใหม่
- เทสที่เกินเวลาไม่ถูกปิด, output ของเทสที่เกิน 1 MB ถูกรายงานว่า fail และการ verify บางส่วนถูกนับเป็นหลักฐาน
- Stop hook ไม่ทำงานใน monorepo, glob แบบ `{...}` ไม่จับอะไรเลยโดยไม่เตือน และ config ที่ใส่ string แทน array ทำให้ guard crash

ตอนเปลี่ยน repo ให้เป็นกลาง เจอปัญหาเพิ่มอีก 3 ข้อและแก้แล้ว: เทสทิ้งโฟลเดอร์ชั่วคราวไว้, template CI รันแผนที่ API เสมอ (ทำให้โปรเจคที่ไม่ใช่ backend fail ทุกครั้ง) และ verify รู้จักแค่ HTTP

การตรวจรอบที่สอง และผู้ทดสอบที่ลองติดตั้งกับโปรเจค Python 2 ตัวโดยอ่านแค่เอกสารภาษาอังกฤษ พบ:

- command check ตรวจแค่ output 8–16 KB สุดท้าย error ที่พิมพ์ช่วงต้นของ log ยาวๆ จึงผ่าน `expectOutputExcludes` ได้ ตอนนี้ตรวจได้ถึง 8 MB และถ้าเกินจะ fail พร้อมบอกเหตุผล
- รันแค่ command check ก็ยังเปิด server (หรือหยุดเพราะพอร์ตไม่ว่าง) ตอนนี้เปิด server เฉพาะเมื่อมี HTTP check หรือ check ที่ใส่ `needsServer`
- รัน `init` ซ้ำด้วย preset อื่น ได้ config สอง preset ปนกันโดยไม่เตือน ตอนนี้ `init` บันทึก preset และไม่ยอมให้ปน
- `^` ใน pattern ของ guard ตรงแค่บรรทัดแรก และ `\b` ตัวเดียวใน JSON กลายเป็นตัวอักษร backspace ที่มองไม่เห็น ตอนนี้ pattern เป็น multiline เสมอ และไม่รับ control character
- guard สแกน cache ของ Python และ regex ของ route ใช้ได้แค่กับ Express ตอนนี้ข้ามโฟลเดอร์ของ Python และ build ของ Rust/Java เป็นค่าเริ่มต้น source กำหนด method คงที่ได้ และเอกสารมี regex ที่ทดสอบแล้วสำหรับ Express, FastAPI, Flask และ Go
- เอกสารเพิ่มเรื่องการใส่ quote บน Windows, ขีดจำกัดของ output, flag ของ regex และข้อจำกัดว่ากฎ import ใช้ได้เฉพาะ JS/TS
