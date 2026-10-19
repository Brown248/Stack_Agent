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
| Verification: agent ต้องพิสูจน์ว่าโปรแกรมทำงานจริง | `scripts/verify.mjs` (เทส, server, HTTP check, command check, หลักฐาน) และ skill `verify` | `tests/verify.test.mjs`, `tests/verify-command.test.mjs` และตัวอย่างทั้งสองผ่าน verify แบบเต็ม |
| Close the loop: เช็กผลเองใน session เดียวกัน | หลักฐานใน `.stack-agent/evidence/latest.json` (บันทึกว่ารันเต็มหรือบางส่วน) และ Stop hook `stop-verify.mjs` | `tests/hooks.test.mjs`, `tests/stop-hook.test.mjs` |
| Feature map: ฟีเจอร์ไหนอยู่ตรงไหน | `scripts/api-map.mjs` สำหรับ HTTP backend พร้อมตรวจ drift | `tests/api-map.test.mjs` และ eval ที่รันจริง (ด้านล่าง) |
| Hard constraint อยู่ใน lint/CI ไม่ใช่ prompt | `scripts/guard.mjs` และ `templates/ci/stack-agent.yml` | `tests/guard.test.mjs`, `tests/presets.test.mjs` |
| ทางที่ขี้เกียจที่สุดต้องเป็นทางที่ถูก | ทุกกฎต้องมี `fix` และ hook PostToolUse ส่ง fix ให้ agent ทันทีหลังแก้ไฟล์ | เทสของ config และ hook |
| เปลี่ยน comment ที่เตือนซ้ำให้เป็นกฎ | skill `correct` (ไล่จาก architecture → types → guard → test → docs) | ขั้นตอนใน skill |
| Ratchet สำหรับ repo ที่ใช้ร่วมกัน | baseline, `--allow-increase`, `--compare-ref` | เทส ratchet และ compare-ref |
| สุ่มตรวจแทนการรีวิวทุก PR | `scripts/sample-commits.mjs`, skill `sample-review` และ agent `reviewer` | `tests/sample-commits.test.mjs` |
| Eval คือ unit test ของ skill ตรวจแบบ blind โดยโมเดลอื่น | `evals/` ตามรูปแบบ `claude plugin eval` (เทียบมี/ไม่มี plugin, judge เป็น haiku โดยค่าเริ่มต้น), agent `judge`, skill `run-evals` | รันจริง 1 case (ด้านล่าง) |
| งานที่ผลตายตัวเป็น script งานที่ต้องคิดให้ agent | script ไม่มี dependency สำหรับทุกขั้นที่ทำซ้ำ | 122 เทส |
| Skill เล็ก ต่อกันได้ มี script และดีขึ้นทุกครั้ง | 9 skills และ `reflect` สำหรับปรับปรุง | `claude plugin validate --strict` |
| คุมว่าใครเรียก skill ได้ | `disable-model-invocation: true` สำหรับ skill ที่เขียนไฟล์หลายจุดหรือใช้เงิน | frontmatter ของ skill |
| ชั้นระหว่าง prompt กับ CI ตอนทำงาน | `hooks/hooks.json`: PreToolUse (คำสั่ง shell และการแก้ไฟล์ของ guard), PostToolUse, Stop | `tests/hooks.test.mjs` |

## ที่ตั้งใจไม่ทำ

- **Auto-merge และ outer loop** (ดึงงานจาก Slack หรือ tracker): ควรเพิ่มหลังจาก verification กับ guard มีผลงานใน repo ของคุณแล้ว
- **การคุมเบราว์เซอร์ (Control Glass):** ให้ใช้ตัวรัน e2e ของโปรเจคเป็น command check (preset `frontend-web`) เพราะตัวคุมเบราว์เซอร์ในตัวจะเพิ่ม dependency หนัก
- **Cloud agent (Benny):** ต้องใช้ Cursor Automations ซึ่ง Claude Code ไม่มี
- **กฎเฉพาะ codebase จากทอล์ก** (ห้าม `useEffect`, ห้าม code comment): เป็นกฎของ codebase เดียว ถ้าต้องการให้เขียนเป็นกฎแบบ `pattern`

## ข้อจำกัดที่รู้อยู่

- กฎที่อ่าน import รองรับเฉพาะ JS/TS ภาษาอื่นใช้กฎแบบ `pattern`
- hook ที่ดักคำสั่ง shell ใช้การจับ pattern ถ้าตั้งใจเลี่ยง (เช่นใช้ alias หรือ script ที่เขียนไฟล์โดยไม่ระบุชื่อไฟล์ในคำสั่ง) อาจหลุดได้ CI ที่มี `--compare-ref` และ CODEOWNERS คือด่านที่ไม่มีทางหลุด
- guard ใน PostToolUse ตรวจการแก้ผ่าน Edit/Write ส่วนการแก้ผ่าน shell จะถูกจับโดย CI และ Stop hook
- ratchet นับต่อไฟล์ต่อกฎ
- judge แบบ LLM ใน Claude Code เลือกได้เฉพาะโมเดล Claude คำว่า "คนละโมเดล" จึงหมายถึงโมเดล Claude อีกตัว

## สถานะการตรวจสอบ

| สิ่งที่ตรวจ | สถานะ |
| --- | --- |
| Unit และ integration test | ผ่าน 122 เทสบน Windows 11 กับ Node 25 |
| ตัวอย่างทั้งสอง (Node API, Python CLI) | ผ่าน guard และ verify แบบเต็ม |
| Mutation check (จงใจใส่บั๊ก 14 จุด) | เทสจับได้ครบ |
| `claude plugin validate --strict` | ผ่าน |
| Eval `api-map-lookup` (อ่านอย่างเดียว) | รันจริง 2 ครั้ง: มี plugin 1.0, ไม่มี 0.5, ส่วนต่าง +0.5 ทั้งสองแบบตอบถูก ที่ต่างคือแบบมี plugin อ่านแผนที่ก่อน |
| Eval ที่ใช้ Bash (`add-endpoint-delete-item`, `verify-before-done`, `add-migration-column`) | โหลดได้ถูกต้อง แต่ยังไม่ได้รัน เพราะต้องใช้ Linux, macOS หรือ WSL2 |
| CI บน Linux และ Windows ด้วย Node 22/24 | ตั้งค่าแล้ว ยังไม่ได้รัน |
| Hook ใน session Claude Code จริง | ยืนยันแล้วด้วยการรันจริงแบบ headless (`claude -p --plugin-dir`, Claude Code 2.1.300, haiku, รวม $0.05): การปฏิเสธ `--no-verify`, การถามก่อนแก้ guard baseline, guard หลังแก้ไฟล์ และการเตือนตอน Stop ทำงานครบ และการเตือนไม่เด้งซ้ำในครั้งที่สอง |
| ความเร็วของ guard ตอนสแกนทั้ง repo | หลัง cache regex ของ glob และตัดการเช็กไฟล์ที่ซ้ำ: repo สังเคราะห์ที่ไม่มี import ขนาด 1k/5k/20k ไฟล์ จาก 1,535→180 ms, 2,872→639 ms, 16,698→2,239 ms ส่วน repo ที่มี import เยอะ (`scripts/bench-guard.mjs`) เร็วขึ้น 13–17% จากนั้นให้หาไฟล์ปลายทางของแต่ละ import บนดิสก์แค่ครั้งเดียวต่อการรัน แทนที่จะหาทุกครั้งที่เจอ import: repo ที่มี import เยอะขนาด 1k/5k ไฟล์ ค่ามัธยฐาน 566→254 ms และ 2,859→1,312 ms (ราว 2.2 เท่า เครื่องที่วัดมีโหลดแกว่ง รอบที่เร็วที่สุด 511→213 และ 1,775→860 ms) ผลลัพธ์เหมือนเดิมทุกไบต์ทุกขั้น การรันซ้ำแยกต่างหากภายหลังบนเครื่องที่มีงานอื่นแย่ง CPU ผลแกว่งเกินกว่าจะยืนยันอัตราที่แน่นอนได้ (เร็วขึ้น 3 ใน 4 ครั้ง ราว 1.7–3 เท่า และช้าลง 1 ครั้ง) จึงให้ถือเป็นตัวเลขโดยประมาณ ส่วนผลลัพธ์ตรงกันทุกไบต์ทุกครั้ง |

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
