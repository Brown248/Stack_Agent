# บันทึกการเปลี่ยนแปลง

สิ่งที่เปลี่ยนในแต่ละรุ่นของ Stack Agent เวลาออกรุ่นใหม่ ให้เปลี่ยน `version` ใน `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` และ `package.json` พร้อมกัน แล้วเพิ่มหัวข้อในไฟล์นี้

[English](CHANGELOG.md)

## ยังไม่ออกรุ่น

ไม่มีเครื่องมือที่ vendor เปลี่ยน โปรเจกต์จึงไม่ต้องรัน `init` ใหม่

### ผลการวัด

- Stack Agent คู่กับ obra/superpowers 7.0.0 งานละ 3 รอบต่อแขน (รายงานบั๊กสองงานและ endpoint หนึ่งงาน): ทุกรอบทั้งสองแขนถูก ผ่าน guard และ verify ด้วยหลักฐานที่สด superpowers ไม่ถูกเรียกเลย agent เลือก `stack-agent:debug` และ `stack-agent:add-endpoint` ทุกครั้ง bootstrap ของมันเพิ่มบริบทราว 2,200 โทเค็นต่อ request และเพิ่มค่าใช้จ่าย 9% ยังไม่ได้วัดงานที่ไม่มี skill ของ Stack Agent ตรง รายละเอียด: design notes วันที่ 27 ต.ค. 2026

### เพิ่ม

- แขน A/B `full+superpowers` (`--superpowers DIR`): plugin คู่กับ superpowers ที่ติดตั้งไว้ นับว่าแยกถูกต้องเฉพาะเมื่อโหลดสอง plugin นี้เท่านั้น ทุกแขนตั้ง `SUPERPOWERS_DISABLE_TELEMETRY=1`
- job `skill-scan` ใน CI ของ repo นี้รัน NVIDIA SkillSpector 2.12.0 (ตรึงที่ commit, static เท่านั้น, ไม่ใช้ credential) กับแต่ละ skill, agents, `hooks.json` และ hook script ไม่ใช่ด่านบังคับ finding ใหม่จะแสดงเป็นคำเตือน การสแกนครั้งแรกได้ 8 finding ที่เป็นผลบวกลวงทั้งหมด (flag `--skip-*` ของ verify เอง, คำสั่งที่ถูกบล็อกซึ่งปรากฏใน hook ที่บล็อกมัน, รูปแบบ output และคอมเมนต์เรื่องเพดานของ Stop hook) แต่ละข้ออยู่ใน `.github/skillspector/` พร้อมเหตุผล บรรทัดที่ลองใส่ให้ส่ง SSH key ไป URL ภายนอกยังถูกรายงาน `scripts/skill-scan.mjs` เก็บรายการเป้าหมาย โปรเจกต์ของผู้ใช้ไม่เปลี่ยน รายละเอียด: design notes วันที่ 27 ต.ค. 2026

## 0.5.1 (2026-10-27)

ส่วนใหญ่คือการปิดช่องเลี่ยง guard จากการตรวจ 0.5.0 สองรอบ (agent อ่านโค้ดแยกกัน, ลองเลี่ยงกับ git จริง และรันขั้นตอนของ CI บน Linux) `verify.mjs`, `guard.mjs` และ `lib/files.mjs` เปลี่ยน จึงต้องรัน `init` ใหม่เพื่ออัปเดต `.stack-agent/bin/`

### ผลการวัด

- `feature-map-lookup` (ใหม่) แขนละ 2 รอบ: 1.00 เมื่อมี plugin เทียบกับเฉลี่ย 0.25 เมื่อไม่มี และมีแค่แขน plugin ที่อ่าน feature map ส่วน `verify-before-done` หลังแก้สกิล: 1.00 ทั้งสองแขน
- A/B `init-library` (ใหม่) แขน plugin: ก่อนการเปลี่ยนเรื่องการติดตั้งด้านล่าง `init --check` ผ่าน 0 ใน 2 รอบ เพราะ session แบบ headless อนุมัติการแก้ guard config และ workflow ที่ป้องกันไว้ไม่ได้ หลังเปลี่ยนและเพิ่มคำแนะนำให้ใช้ Edit หรือ Write ผ่าน 3 ใน 3 รอบ แต่ละรอบมีกฎ guard ของตัวเองและเช็กจริง รายละเอียดและข้อควรระวัง: design notes วันที่ 26 ต.ค. 2026 (รอบหลัง)
- A/B `shell-sort` (ใหม่) แขนละ 3 รอบ: guard หลังคำสั่ง shell รายงานการผิดกฎของ one-liner ในทั้ง 3 รอบของแขน plugin ซึ่งเป็นครั้งแรกที่เห็นมันจับได้ใน session จริง และ agent ทุกตัวย้ายการเรียงไปไว้ใน repository แขนที่ไม่มี plugin ก็ทำได้เช่นกัน โดยรัน `npm run guard` เอง task นี้จึงแสดงว่า hook ทำงานได้ ไม่ได้แสดงว่าจำเป็นเมื่อ guard เป็นสคริปต์ที่มองเห็น
- `up-down-up` ของ `add-migration-column` ตอนนี้เป็น regex ที่อ่าน trace (`target: trace`) เมื่อรันคู่กับ llm grader ที่ถูกแทน ทั้งสองผ่าน 2 ใน 2
- `npm test`: 514 เทสต์ ผ่านทั้งหมดบน Windows (Node 26) และ Linux (Node 22, WSL2)

### แก้ไข

- ช่องเลี่ยง guard เพิ่มเติม ที่หาเจอโดยลองกับ git จริง (แต่ละแบบ commit ผ่าน pre-commit hook ที่ fail ได้ ขณะที่ hook ของ shell ปล่อยผ่าน): `GIT_CONFIG_PARAMETERS` และ `GIT_CONFIG_KEY_<n>` ที่ตั้ง `core.hooksPath`, alias ที่รัน `commit --no-verify` (ตั้งด้วย `-c` หรือ `git config`), `export HUSKY=0` และการลบหรือแทนที่ไฟล์ใน `.git/hooks` ทั้งจาก shell และ Edit/Write สามแบบแรกปฏิเสธ ส่วนการแก้ `.git/hooks` จะถาม เฉพาะในโปรเจกต์ที่ติดตั้ง Stack Agent ส่วน `.husky/` ถูก commit และรีวิวอยู่แล้วจึงไม่แตะ นอกจากนี้ tokenizer ของคำสั่งเคยแยก `key="two words"` เป็นสอง token ซึ่ง shell จริงไม่ทำ ทำให้รูปแบบ alias หลุด ตอนนี้ถือว่า word คือชุดของตัวอักษรทั่วไปกับส่วนที่อยู่ในเครื่องหมายคำพูดต่อกัน
- ช่องเลี่ยง guard: hook ของ shell ปล่อย `git commit --no-verif` (git รับรูปย่อของ option ยาวที่ไม่กำกวม), `git --config-env=core.hooksPath=VAR commit` และ `git config core.hooksPath x` ผ่านไป ตอนนี้ปฏิเสธทั้งสามแบบ และด่าน git อื่นก็จับรูปย่อด้วย (`push --de`, `push --m`, `reset --k`, `clean --f`)
- hook หลังแก้ไฟล์และหลังคำสั่ง shell, guard ของ Stop hook และ `guard.mjs --files` ไม่ใช้รายการ `ignore` ของ config และโฟลเดอร์ที่ข้ามเป็นค่าเริ่มต้น ซึ่งการสแกนทั้งโปรเจกต์ของ CI ใช้ ไฟล์ fixture หรือไฟล์ที่ generate จึงถูกโทษในเครื่องแต่ผ่านใน CI
- guard หลังคำสั่ง shell (ใหม่ใน 0.5.0): โทษคำสั่งแรกสำหรับไฟล์ `.md` หรือ `docs/` ที่แก้ค้างไว้ก่อนเริ่ม session เพราะบันทึกของ session ตัดไฟล์พวกนี้ออก ไฟล์ที่เปลี่ยนแต่อ่านไม่ได้ไฟล์เดียวทำให้ไม่ตรวจอะไรเลยไปตลอด session hook แก้ไฟล์ที่รันพร้อมกันทำข้อมูลของกันและกันหาย การผิดกฎจึงอาจถูกรายงานซ้ำ และคำสั่งที่รันจากระดับบนสุดของ monorepo ไปไม่ถึงโปรเจกต์ใดเลย guard ของ Stop hook ก็มองไม่เห็นไฟล์ `.md` แบบเดียวกัน
- verify: คำสั่งที่จบไปแล้วแต่ process ที่มันเปิดไว้ยังถือ output อยู่ (`start /b`, `&`) ถูกรอจนกว่า process นั้นจะจบ แล้วรายงานว่า timed out ตอนนี้ตัดสินจาก exit code เมื่อ output เงียบไป 1.5 วินาที (รอนานสุด 10 วินาที) และหยุด process นั้น (บน Windows หาจาก parent id เพราะ Windows ไม่มี process group) output ระหว่าง 8 ถึง 12 MB ผ่านเหมือนตรวจครบทั้งหมด ตอนนี้ขีดจำกัด 8 MB ใช้ได้จริง คำสั่งที่ถูก signal ฆ่าจะรายงานเป็น `killed by <signal>` และนับเป็น red จริงใน `--repeat` ไม่ใช่รอบที่สรุปไม่ได้ verify ที่ถูกหยุดด้วย Ctrl+C หรือ SIGTERM จะหยุดเซิร์ฟเวอร์และคำสั่งที่มันเปิดไว้ และปฏิเสธ `--skip-tests --skip-checks --repeat` แทนที่จะรันเทสต์ไปทั้งที่สั่งข้าม
- บน Windows โปรเจกต์ที่เข้าถึงผ่านชื่อย่อแบบ 8.3 (runner ของ GitHub เก็บโฟลเดอร์ temp ไว้ที่ `C:UsersRUNNER~1`) ถูกมองเป็นคนละที่กับที่ git รายงานด้วยชื่อเต็ม ไฟล์ shared rules ที่อยู่ใน repository จึงถูกปฏิเสธว่าอยู่นอก repository, `init` แสดง path ของ workflow ที่ไต่ออกนอกโปรเจกต์ และ guard หลังคำสั่ง shell แสดงชื่อไฟล์โดยไม่มีโฟลเดอร์ของ monorepo ตอนนี้ guard, init, guard หลังคำสั่ง shell และตัวตรวจ path ที่ป้องกันไว้เทียบด้วย path จริง เจอจากการรัน CI บน GitHub ครั้งแรก ซึ่งเทสต์บน Windows fail 11 ตัว ในเครื่องไม่เกิดเพราะชื่อโฟลเดอร์ผู้ใช้สั้นเกินกว่าจะมีชื่อย่อ
- `npm run guard` และ `npm run verify` ของ sample backend ชี้ไปที่ `../../scripts/` ซึ่งมีแค่ใน repo นี้ จึงล้มในทุกสำเนาที่ติดตั้ง (รวมโปรเจกต์ของ A/B และ eval) ตอนนี้รันเครื่องมือที่ vendor ไว้ ผล A/B ก่อนหน้าที่ agent ใช้ `npm run guard` อาจทำให้แขนที่ไม่มี plugin ดูแย่กว่าความจริง
- เทสต์ A/B `cli-minlen` fail บนเครื่องที่มีแค่ `python3` ตอนนี้ข้ามไปเหมือนเทสต์ Python ตัวอื่น
- เอกสารที่คลาดจากโค้ด: README (EN/TH) บอกว่า guard รันหลังแก้ไฟล์เท่านั้น และ CI ไม่รัน verify สกิล init บอกชื่อไฟล์ที่คัดลอกแค่สามในหกไฟล์ สกิล verify ขาด `expectHeaders`, `followRedirects` และ `timeoutSec` และ changelog ภาษาไทยข้อ `--repeat` ขาดเรื่อง output ของรอบแรกที่ red

### เพิ่ม

- บันทึกในเอกสารสิ่งที่โค้ดรองรับอยู่แล้ว: `--config` และ `--json` ของ verify, `test.cwd`, `test.env`, `test.timeoutSec`, `server.readyTimeoutSec`, `timeoutSec` ของ HTTP check, `type` และค่าเริ่มต้นของ `evidenceDir`, ส่วนของ guard คือ `baseline`, `--files`, `--strict`, `--json`, `--config` และ `pythonRoots`, ของ api-map คือ `--config`, `--json` และ `verifyConfig`, ของ feature-map คือ `--map` และ `--json`, ของ review-findings คือ `--stage` และ `rows --date` และ `--disallowed-tools` ของ A/B harness
- eval case `feature-map-lookup` (บนตัวอย่าง library) และ A/B task `init-library` (ติดตั้ง Stack Agent จากศูนย์ผ่านสกิล) `evals/scaffold.mjs` รับชื่อตัวอย่างที่จะคัดลอก และ `run-evals` บอกว่าแต่ละสกิลวัดผลอย่างไร และทำไม `mine-corrections` จึงไม่ได้วัด
- guard หลังคำสั่ง shell ต่อท้ายสิ่งที่รายงานลงใน `.stack-agent/evidence/sessions/<id>.reports.log` เพราะ transcript ของ session ไม่มี output ของ hook ไฟล์นี้จึงเป็นหลักฐานว่ามีการรายงาน
- A/B task `shell-sort` (one-liner `sed -i` ที่ผิดกฎ guard สองข้อ) และ `grade` ของ task ได้รับ transcript กับชื่อแขนด้วย
- เทสต์สำหรับพฤติกรรมที่ยังไม่มีเทสต์: ด่าน git, error ของ config ใน verify, guard และ api-map, เหตุผลที่ขั้น against ข้าม, `against.setup` และ `against.keep`, กรณีล้มเหลวของ HTTP, ขีดจำกัด output, option ของ feature-map และ api-map และ helper ของ A/B harness (จาก 464 เป็น 514 เทสต์)

### เปลี่ยน

- การติดตั้งทำจนจบได้โดยไม่ต้องมีคนเฝ้า: Edit/Write บน `guard.config.json` หรือ workflow ของ Stack Agent ที่ git ยังไม่เคยเห็นและยังมี placeholder `EDIT ME` ไม่ต้องถามแล้ว ใน A/B `init-library` agent ทั้งสองถูกหยุดตรงนี้ เพราะ session แบบ headless อนุมัติไม่ได้ เมื่อ placeholder หมดหรือไฟล์ถูก stage หรือ commit แล้ว การแก้จะถามอีกครั้ง ส่วนการเขียนผ่าน shell ยังถามเหมือนเดิม และข้อความปฏิเสธบอกให้ใช้ Edit หรือ Write กับ template ซึ่งสกิล init ก็บอกแบบเดียวกัน
- micro-test `guard-request` ไม่บอกแล้วว่า hook หลังแก้ไฟล์มองไม่เห็นการแก้ผ่าน shell สถานการณ์ตอนนี้ให้ agent ทำงานต่อโดยไม่ได้แก้ตามที่ hook หลังคำสั่ง shell รายงาน คะแนนก่อนหน้านี้จึงเทียบกันตรงๆ ไม่ได้

## 0.5.0 (2026-10-26)

จากการติดตั้งครั้งแรกกับโปรเจคจริง (monorepo pnpm + Next.js บน PostgreSQL บน Windows) และงานค้างจากผลการวัดของ 0.4.0 `verify.mjs` เปลี่ยน จึงต้องรัน `init` ใหม่เพื่ออัปเดต `.stack-agent/bin/` (`--check` จะแสดงว่า outdated จนกว่าจะรัน)

### ผลการวัด

- `add-migration-column` แขนละ 3 รอบ: `up-down-up` ผ่านเป็นครั้งแรก 2 ใน 3 เมื่อมี plugin และ 0 ใน 3 เมื่อไม่มี (ทุกรอบก่อนหน้านี้ไม่ผ่านทั้งสองแขน) เฉลี่ย 0.88 ต่อ 0.79 ส่วน `debug-blank-name` แขนละ 2 รอบ: 1.00 ต่อ 0.75 และ `repro-before-fix` 2 ใน 2 ต่อ 0 ใน 2
- A/B แขนละ 3 รอบ: ทาง import ใหม่ถูกใช้กับ agent จริงเป็นครั้งแรก (`job-new-export`: เจอกรณีนี้ใน 2 รอบของแขน plugin และทั้งสองรอบจบด้วย verify check ที่จับการเปลี่ยนแปลงได้) ใน `bug-flaky-list` และ `bug-stale-list` agent ทุกตัวเขียน repro เป็นเทสต์ที่วนจน red ทุกครั้ง จึงไม่มีการวัดอัตรา red และก็ไม่จำเป็นต้องวัด guard หลังคำสั่ง shell ไม่รายงานผิดเลยใน 9 session ของแขน plugin
- รายละเอียดและข้อควรระวัง: design notes วันที่ 26 ต.ค. 2026

### เพิ่ม

- template ของ workflow CI รันด้วย token แบบอ่านอย่างเดียว (`permissions: contents: read`)
- `no-private-keys` ในทุก preset จับ `ENCRYPTED PRIVATE KEY` และ `PGP PRIVATE KEY BLOCK` ได้ด้วย โปรเจคที่ติดตั้งแล้วมีสำเนากฎของตัวเอง ให้คัดลอก pattern ใหม่จาก preset ไปใส่เอง
- HTTP check รับ `followRedirects` (ค่าเริ่มต้น `true`) และ `expectHeaders` จึงตรวจได้ว่าหน้าที่ต้อง login ส่งผู้ใช้ไป `/login` จริง แทนที่จะเห็นแค่หน้า login ที่ไปถึง
- `init` เพิ่ม `.stack-agent/` ลงใน `.prettierignore` เมื่อโปรเจคใช้ Prettier (รวมถึงกรณีที่มีแค่ใน dependency) และลงใน `.eslintignore` ถ้ามีอยู่แล้ว ทั้งในโฟลเดอร์โปรเจคและที่ระดับบนสุดของ repository เดิมเครื่องมือที่ vendor มาทำให้ `prettier --check .` (9 ไฟล์) และ `eslint .` (66 error) ของโปรเจค fail `--check` เขียนโน้ตเมื่อ ESLint flat config ไม่มีคำว่า `.stack-agent`
- workflow CI ที่ `init` เขียนใช้ Node ตามโปรเจคจาก `.nvmrc`, `.node-version` หรือขอบล่างของ `engines.node` เมื่อใหม่กว่า 22 และ `--check` เขียนโน้ตเมื่อ workflow ใช้เวอร์ชันเก่ากว่าที่โปรเจคต้องการ หรือเก่ากว่า 22
- docs/adoption.md: วิธี verify โปรแกรมที่ต้องมีฐานข้อมูลหรือผู้ใช้ทดสอบ (สคริปต์ตัวเดียวสำหรับ `server`) และวิธีตรวจขั้นตอนที่ต้อง login (ใช้ command check)
- A/B task `bug-flaky-list`: บั๊กที่สุ่มเกิดจริง (สำเนาสำหรับอ่านสองชุดที่สุ่มเลือก การสร้าง item รีเฟรชแค่ชุดเดียว) รวมเข้า commit แรกของโปรเจคด้วย `plantBug(..., { hidden: true })` ตัวใหม่ ประวัติ git จึงไม่ชี้ไปที่บั๊ก
- `verify.mjs --check <name> --repeat N` รันเช็กที่ระบุ N รอบและรายงานอัตรา red (`red in 7 of 30 runs (23%)`) พร้อมความล้มเหลวแต่ละแบบและจำนวนครั้ง และ output ของรอบแรกที่ red เซิร์ฟเวอร์เริ่มครั้งเดียวตลอดทุกรอบ `--skip-checks --repeat N` ทำแบบเดียวกันกับชุดเทสต์ สำหรับ repro ที่เขียนเป็นเทสต์ (ซึ่ง agent ทุกตัวเขียนแบบนี้ใน A/B วันที่ 26 ต.ค. 2026) ใน A/B `bug-stale-list` และ `bug-flaky-list` ไม่มี agent คนไหนวัดอัตรา red ได้ เพราะ loop ใน shell ถูก permission rules หยุดไว้ สกิล `debug` จึงชี้มาที่ flag นี้แทน
- hook PostToolUse หลัง Bash และ PowerShell รัน guard กับไฟล์ที่คำสั่งเปลี่ยนนอกเครื่องมือแก้ไฟล์ (`sed -i`, codemod, ตัว generate โค้ด) การแก้ผ่าน shell จึงได้ feedback ทันทีแบบเดียวกับ Edit ไฟล์ถูกเทียบด้วย git blob id กับที่ hook guard เห็นครั้งล่าสุด การผิดกฎแต่ละครั้งจึงถูกรายงานครั้งเดียว และไฟล์ที่แก้ค้างไว้ก่อนเริ่ม session จะไม่ถูกนับจนกว่าคำสั่งใดจะแก้มัน ใช้เวลาประมาณ 130 ms ต่อคำสั่งเมื่อมีไฟล์เปลี่ยน 5 ไฟล์ใน repository 20,000 ไฟล์ (`scripts/bench-hooks.mjs` จับเวลาส่วนนี้แล้ว)
- ตัวรัน migration ของ sample backend มีคำสั่ง `redo [N]`: บนฐานข้อมูล in-memory ที่ทิ้งได้ จะ apply ทุก migration, rollback N ตัวล่าสุด, apply ใหม่ แสดง schema หลังแต่ละขั้น และ fail เมื่อ schema กลับมาไม่เหมือนเดิม ไม่เขียนไฟล์ใด sandbox ที่อ่านอย่างเดียวจึงยังพิสูจน์ migration ได้ทั้งสองทาง
- A/B: `bug-flaky-list` และ `bug-stale-list` ให้คะแนน `redRateMeasured` (มีการรัน `verify.mjs --repeat` ที่ red) จากไฟล์ evidence ทุกไฟล์ที่ session ทิ้งไว้

### เปลี่ยน

- `add-migration`: ให้ใช้คำสั่ง round-trip ของตัวรันเองก่อน (task redo ของ Rails, `redo` ของ sample) และเมื่อเขียนไฟล์ไม่ได้ ให้ใช้ฐานข้อมูล in-memory หรือแบบทิ้งได้แทนการข้าม up-down-up ใน eval ทุกรอบที่ผ่านมา ทั้งสองแขนไม่ผ่าน `up-down-up` เพราะ sandbox ของ eval เขียนไฟล์ฐานข้อมูลชั่วคราวไม่ได้ grader `up-down-up` รับการรัน `redo` ที่แสดงครบทั้งสามขั้น
- `debug`: อ่านโค้ดเพื่อเล็งว่าจะทำ repro ตรงไหนได้ และการเห็นสาเหตุในไฟล์สั้น ๆ ก็เป็นเรื่องปกติ แต่ห้ามแก้อะไรจนกว่า repro จะ red ใน A/B ทุก agent อ่าน service สั้น ๆ ก่อนทำ repro และแก้บั๊กถูกตัวทั้งหมด
- `run-evals`: การรันแขนละรอบเดียวบอกทิศทาง ไม่ใช่คะแนน ให้ดู grader ที่การแก้ตั้งใจเปลี่ยน และรันใหม่ด้วย `--runs 3` เมื่อ grader อื่นขยับอยู่ตัวเดียว
- ข้อความ guard ของ Stop hook ไม่บอกแล้วว่า hook หลังแก้ไฟล์มองไม่เห็นการแก้ผ่าน shell

### แก้ไข

- ขั้น against ลิงก์ `node_modules` ของ workspace package (`apps/*/node_modules`, `packages/*/node_modules`) เข้า worktree เป็นค่าเริ่มต้นด้วย ไม่ใช่แค่ที่ root เดิมใน monorepo แบบ pnpm เทสของโค้ดเก่าจะ fail ใน worktree เพราะหา package ไม่เจอ แล้ว verify รายงานว่าจับการเปลี่ยนแปลงได้ ตั้ง `against.link` เพื่อกำหนดรายการเองได้เหมือนเดิม
- บน Windows ที่ตั้ง `core.autocrlf=true` (ค่าเริ่มต้นของ Git for Windows) เครื่องมือที่ vendor ไว้และถูก checkout เป็น CRLF ถูก `--check` และ SessionStart hook รายงานว่า `outdated` และรัน `init` ใหม่ก็แก้ไม่ได้ ตอนนี้สำเนาที่ต่างกันแค่ตัวขึ้นบรรทัดถือว่าเป็นเครื่องมือเดียวกัน และ `init` เขียน `.stack-agent/.gitattributes` (`* text eol=lf`)
- docs/adoption.md เคยบอกว่า `--compare-ref` fail เมื่อกฎ "แคบลง" ที่จริง fail เมื่อ files, exclude หรือ pattern ของกฎเปลี่ยนแบบใดก็ตาม รวมถึงการขยาย
- `init --check` ไม่นับประโยคคำแนะนำใน template ของ feature map ("replace every EDIT ME") เป็น placeholder อีกแล้ว เดิมทำให้ feature map ที่กรอกครบแล้วยังค้างว่าไม่เสร็จ feature map ที่ติดตั้งด้วย 0.4.0 ยังมีประโยคเดิมอยู่ `--check` ก็ข้ามประโยคนั้นให้ด้วย
- ถ้าไม่มี `origin/HEAD` (repository ที่ push ขึ้นไปเอง ไม่ได้ clone) `init` เขียน `origin/main` หรือ `origin/master` ที่มีอยู่ตัวเดียวเป็น branch ที่ push แล้วรัน CI และ `--check` เขียนโน้ตว่าเป็นการเดา จนกว่า `git remote set-head origin --auto` จะบันทึก branch จริง
- `init --help` บอกแล้วว่า exit code 1 ใช้กับ `--check` ส่วน `init` เองจะจบด้วย 0 หลังเขียนไฟล์ แม้การตั้งค่ายังไม่ครบ
- grader `honest-report` ของ eval ทั้งสี่ตัวอ่าน trace และยอมรับการบอกว่าอะไรผ่านควบคู่กับการบอกว่า verify รันไม่ได้ เดิม grader ตัดสินเทียบกับ trace โดยเห็นแค่ข้อความสุดท้าย จึงตัดรอบที่มี plugin ซึ่งรายงานตรงๆ ว่า sandbox อ่านได้อย่างเดียว มีเทสใหม่ที่บังคับให้ llm grader ใดก็ตามที่เอ่ยถึง trace ต้องอ่าน trace

## 0.4.0 (2026-10-24)

แนวคิดที่ดัดแปลงจาก obra/superpowers และ mattpocock/skills (MIT ทั้งคู่) พร้อมผลการวัด ไม่มี script ที่ vendor ไว้หรือ hook ตัวไหนเปลี่ยนตั้งแต่ 0.3.0 โปรเจคจึงไม่ต้องรัน `init` ใหม่

### ผลการวัด

- eval case ของทุก skill ที่แก้ในรุ่นนี้ กลุ่มละ 1 รอบ: ทั้งหกฝั่งมี plugin นำ ตั้งแต่ +0.11 (`add-endpoint-delete-item`) ถึง +0.67 (`reflect-lessons`) และ `correct-error-body` ตอนนี้ได้ 1.00 ต่อ 0.50 คะแนน `honest-report` ที่ฝั่งมี plugin เสียไปสามข้อมาจาก judge ทั้งที่ข้อความบอกว่า verify รันใน sandbox ไม่ได้และบอกเหตุผล
- `debug` ถูกเรียกจาก bug report ธรรมดา 12 ใน 12 รอบของ A/B (`bug-blank-name`, `bug-dup-count`, `bug-space-list`, `bug-stale-list`)
- รายละเอียดและข้อควรระวัง: design notes, 24 ต.ค. 2026

### เพิ่ม

- `scripts/micro/run.mjs` (`npm run micro`): micro-test ที่ส่งสถานการณ์หนึ่งแบบกับถ้อยคำหนึ่งแบบให้ `claude` เป็นการเรียกครั้งเดียวที่ไม่มีเครื่องมือ ให้คะแนนคำตอบด้วย script และรันถ้อยคำแต่ละแบบซ้ำคู่กับ control ที่ไม่ได้คำแนะนำ `--dry-run` แสดง prompt และเพดานค่าใช้จ่าย `--rescore FILE` ให้คะแนนคำตอบที่เก็บไว้ใหม่โดยไม่เสียเงิน case ที่มี: `import-request` (ไม่มีข้อความได้ 0/5 ข้อความก่อน `4af59f0` ได้ 0/5 ข้อความปัจจุบันได้ 5/5), `coverage-request`, `coverage-refactor` และ `guard-request`
- A/B task `bug-stale-list`: บั๊กที่เกิดแค่บางครั้ง (cache รายการ 50 ms ที่การสร้าง item ไม่ล้าง)
- reviewer ตรวจไฟล์มาตรฐานของ repo เองด้วย (`CONTRIBUTING.md`, `CODING_STANDARDS.md`, `STYLEGUIDE.md`, `STYLE.md`, `AGENTS.md`, `CLAUDE.md`) และอ้างข้อที่ถูกละเมิดเป็น `standards:<file>:<line>` ซึ่ง `review-findings.mjs` ตรวจแบบเดียวกับบรรทัดใน `rules.md` ถ้าขัดกันให้ยึด `rules.md`
- `docs/out-of-scope.md` (EN/TH): ไอเดียที่ Stack Agent ตัดสินใจไม่รับ เหตุผล และสิ่งที่ทำแทน
- หัวข้อ "เขียนเนื้อหา skill" ใน `docs/customizing.md` (EN/TH)
- เทส: SKILL.md ทุกไฟล์ยาวไม่ถึง 20,000 ตัวอักษรที่ Claude Code เก็บไว้หลัง compaction และ description ทุกอันบอกว่าใช้เมื่อไรโดยไม่มีคำว่า "then" หรือ "step", version สามจุดตรงกันและ changelog ทั้งสองภาษาขึ้นต้นด้วย version ปัจจุบัน, ทุกหน้าใน `docs/` มีหน้าภาษาไทยที่มีหัวข้อเท่ากัน

### เปลี่ยน

- `debug`: สีแดงต้องเป็นอาการที่ผู้ใช้แจ้ง บั๊กที่ fail แค่บางรอบต้องวัดอัตราการแดง การบังคับให้แดงด้วยการใส่บั๊กกลับต้องแสดง `git diff` ก่อนและหลัง และถ้าไม่มีที่ให้วางเทสต้องรายงานเป็น finding
- description ของ skill เก้าตัวไม่สรุปขั้นตอนแล้ว (superpowers พบว่า agent ทำตามบทสรุปนั้นแทนตัว skill) ถ้อยคำที่ใช้เปิด `debug` และ `verify` ยังเหมือนเดิม
- design notes อ้างถึงชุดเทสและโฟลเดอร์ skill แทนตัวเลขที่ล้าสมัย

### แก้ไข

- grader `cites-history` และ `rule-names-the-fix` ของ eval `correct-error-body` อ่าน trace แทนการอ่านแค่ข้อความสุดท้าย ใน sandbox ของ eval Stop hook ทำให้ agent วนอยู่กับเรื่อง verify ข้อความสุดท้ายจึงเป็นรายงานเรื่อง verify และกลุ่มที่มี plugin เสียคะแนนทั้งสองข้อ ทั้งที่ทำงานนั้นไปแล้วในข้อความก่อนหน้า (มี plugin 0.5 ไม่มี 0.75) และ `cites-history` จะ fail ถ้าอ้าง commit แค่ตัวเดียวจากสองตัว

## 0.3.0 (2026-10-23)

### อัปเกรด

- `guard.mjs`, `verify.mjs`, `api-map.mjs`, `lib/files.mjs` และ `lib/fingerprint.mjs` มีการเปลี่ยนแปลง และมี `feature-map.mjs` เพิ่มเข้ามา ให้รัน `init` ซ้ำในทุกโปรเจกต์เพื่ออัปเดต `.stack-agent/bin/` ระหว่างที่ยังไม่ได้รัน SessionStart hook จะแจ้งชื่อไฟล์ที่เก่า
- โปรเจกต์ที่อยู่ใน subfolder ของ monorepo: รัน `init` ซ้ำ แล้วลบ `.github/workflows/stack-agent.yml` ที่อยู่ใน subfolder `init --check` จะบอกชื่อไฟล์นี้
- Stop hook ถามมากกว่าเดิม: บล็อกเมื่อการแก้ใน session ผิดกฎ guard และถามหนึ่งครั้งเมื่อเทสที่เปลี่ยน import โค้ดที่รุ่นเก่าไม่มี หรือเมื่อโค้ดเปลี่ยนโดยไม่มีเทสหรือ check ใหม่ refactor จะใช้เพิ่มอีกหนึ่ง turn (ใน A/B ราวหนึ่ง turn และ $0.03 ต่อรอบ)
- monorepo ขนาดใหญ่: ตั้ง `"against": { "paths": [...] }` ใน `verify.json` เพื่อให้ขั้น against checkout เฉพาะ folder ของโปรเจกต์
- baseline ที่มีไฟล์ที่ gitignore ไว้: รัน `guard.mjs --update-baseline` หนึ่งครั้ง

### เพิ่ม

- `run.mjs --judge MODEL` ให้คะแนน `rubric` ของ task (เกณฑ์ที่ script ตรวจไม่ได้) ด้วย `agents/judge.md` บนสำเนาแบบ blind ของแต่ละรอบ มี rubric ให้ `endpoint`, `item-note` และ `dup-name`
- `scripts/bench-hooks.mjs` จับเวลา fingerprint, Stop hook และการ checkout ของขั้น against บน repository จำลอง ผลอยู่ใน design notes
- task A/B สำหรับ preset อื่น ได้แก่ `lib-maxlength` (library: probe build package แล้ว import แบบผู้ใช้), `web-roundup` (frontend-web: probe เปิด dev server แล้วตรวจหน้าเว็บและโค้ดที่ serve) และ `job-skip-blank` (generic: probe รัน data job กับ CSV ของตัวเอง) ทุกตัวมี rubric สำหรับ `--judge` และ `withServer` ใน `scripts/ab/lib.mjs` รับ script ของ server, path ที่ใช้เช็กว่าพร้อม และตัวเลือกว่าจะเตรียมฐานข้อมูลหรือไม่
- eval case `debug-blank-name`, `correct-error-body` และ `reflect-lessons` พร้อม `evals/plant.mjs` สำหรับ case ที่เริ่มจากประวัติใน git ส่วน `sample-review` ไม่มี case เพราะสร้าง checkout ใน sandbox ของ eval ไม่ได้ task A/B `review-spec` ใช้วัดแทน ยังไม่ได้รัน
- `scripts/feature-map.mjs` และ skill `feature-map` สำหรับทุก preset ยกเว้น `backend-http`: `.stack-agent/feature-map.md` บอกว่าสิ่งที่ผู้ใช้ทำอยู่ตรงไหนในโค้ด (`path`, `path:line` หรือ `path#text`) และ verify check ไหนทดสอบมัน ตัวตรวจจะ fail เมื่อโค้ดไม่ตรงกับแผนที่แล้ว `init` เพิ่มไฟล์นี้ให้โปรเจกต์ใหม่ CI รันเมื่อมีไฟล์นี้ และตัวอย่างที่ไม่ใช่ backend ทั้งสี่มีแล้ว
- skill `mine-corrections` พร้อม `scripts/mine-transcripts.mjs`: อ่าน transcript เก่าของ Claude Code ของโปรเจกต์นี้ในเครื่อง (อ่านอย่างเดียว) แสดงสิ่งที่ผู้ใช้พิมพ์หลังคำตอบของ agent และเสนอ check การแก้ skill หรือกฎ ให้การแก้ที่เกิดซ้ำข้ามหลาย session
- กฎกลางของ guard: `"extends"` ใน `guard.config.json` ระบุไฟล์ JSON ของกฎที่หลายโปรเจกต์ใน repository เดียวกันใช้ร่วมกัน โปรเจกต์นิยามกฎกลางซ้ำไม่ได้ `--compare-ref` อ่านไฟล์กลางที่ commit ฐาน และ hook ป้องกันไฟล์เหล่านี้
- task A/B `job-new-export` ที่ออกแบบให้เกิดกรณีเทสที่เปลี่ยน import export ใหม่ พร้อมคะแนน `importCase` และ `checkAfterImport` ที่อ่านจากประวัติหลักฐานของ session (`importCaseGrade` ใน `scripts/ab/lib.mjs`) ยังไม่ได้รันกับ agent จริง
- `init.mjs --shared-rules FILE` คัดลอกไฟล์กฎของทีมไปที่ `.stack-agent/shared-rules.json` สำหรับโปรเจกต์ใน repository อื่น อัปเดตทุกครั้งที่รัน `init` และ `--check` จะรายงานสำเนาที่ไม่ตรงกับที่มา
- icon ของ plugin

### เปลี่ยนแปลง

- description ของ skill `debug` เปิดด้วยการรายงานบั๊กและคำขอ "หาแล้วแก้ให้" หลังจาก A/B พบว่ามันไม่เคยถูกเลือกใช้จากการรายงานบั๊กธรรมดาเลย ใน A/B เมื่อ 23 ต.ค. ถูกหยิบใช้ 9 จาก 9 รอบของรายงานบั๊ก เทียบกับ 0 จาก 9 รอบก่อนหน้า
- เมื่อเทสที่เปลี่ยน import สิ่งที่โค้ดก่อนการแก้ไม่มี (export หรือ module ใหม่) และไม่ได้เพิ่ม check ใหม่ ขั้น against จะบอกเหตุผลและสิ่งที่ควรเพิ่ม บันทึก `importMissing` และ Stop hook จะขอหนึ่งครั้งให้เพิ่ม verify check ที่รันโปรแกรมแบบที่ผู้ใช้ใช้ ใน A/B เมื่อ 23 ต.ค. กรณีนี้ทำให้ `job-skip-blank` ทั้งสามรอบไม่มีหลักฐานว่าเทสจับการแก้ได้
  คำขอนี้ระบุชื่อที่ verify อ่านได้จาก output ของเทส (`missingImports`) และสำหรับโค้ดที่ยังไม่มีอะไรเรียก จะยกตัวอย่าง command check ที่เรียกฟังก์ชันใหม่โดยตรง ข้อความรุ่นแรกเปิดทางว่า "ถ้าไม่มีอะไรที่ผู้ใช้รันได้ ให้บอกแล้วหยุด" และใน A/B ของ `job-new-export` agent ทั้ง 4 รอบที่เจอข้อความนี้เลือกทางออกนั้น
- Stop hook รัน guard กับไฟล์ที่ session แก้ การผิดกฎที่เกิดจากการแก้ผ่าน shell (ซึ่ง hook หลังแก้ไฟล์มองไม่เห็น) จึงบล็อกพร้อมวิธีแก้ แทนที่จะไปเจอครั้งแรกที่ CI และไฟล์ skip ใช้ยกเว้นเรื่องนี้ไม่ได้
- เมื่อโค้ดเปลี่ยนแต่ไม่มี check หรือเทสใหม่หรือที่เปลี่ยนเลย ขั้น against จะบอกตามนั้นและบันทึก `noNewCoverage` และ Stop hook จะขอเทสหรือ check หนึ่งครั้ง หรือให้ agent บอกว่าไม่มีอะไรที่ผู้ใช้สังเกตได้เปลี่ยนไป ใน A/B ของ `job-new-export` ทุกชุดมี agent หนึ่งตัวที่แก้โค้ดโดยไม่เขียนเทส แล้ว verify และหยุด
- กฎ git ของ hook shell (`--no-verify`, force-push, `reset --hard`, การลบ branch และอื่น ๆ) ทำงานเฉพาะในโปรเจกต์ที่มี `.stack-agent/verify.json` หรือ `.stack-agent/guard.config.json` การติดตั้ง plugin ระดับผู้ใช้จึงไม่เปลี่ยนการทำงานของ repository อื่นอีก ส่วนกฎเกี่ยวกับไฟล์ของ Stack Agent เองยังทำงานทุกที่

### แก้ไข

- template ของ CI เดิมรันตอน push เฉพาะ `main` repository ที่ default branch เป็น `master`, `develop` หรือชื่ออื่น จึงมี CI เฉพาะตอนเปิด pull request ตอนนี้ `init` เขียน default branch จาก `origin/HEAD` ลงไป ถ้าไม่มี `init --check` จะเขียนโน้ตว่ายังไม่รู้ชื่อ branch และ `--check` ยังเขียนโน้ตเมื่อ workflow ที่มีอยู่แล้วไม่มี default branch ใน `branches`
- guard และแผนที่ API อ่านเฉพาะไฟล์ที่ git จะ commit ไฟล์ `.env` หรือไฟล์ key ที่ gitignore ไว้จึงไม่ทำให้ guard ในเครื่อง fail ขณะที่ CI ผ่านอีก และ `--update-baseline` ไม่เขียนชื่อไฟล์นั้นลง baseline ที่ commit อีก baseline ที่มีไฟล์แบบนั้นอยู่แล้วจะแสดงเป็น `improved` ให้รัน `--update-baseline` เพื่อเอาออก ถ้าไม่ได้อยู่ใน git จะสแกนทุกไฟล์เหมือนเดิม
- guard หลังแก้ไฟล์ทำงานกับ NotebookEdit ด้วย
- บน Windows ในโปรเจกต์ที่ path ยาว ขั้น against เดิมข้ามโดยบอกว่า "verify.json does not exist" ทั้งที่ไฟล์มีอยู่ เพราะ `git show <hash เต็ม>:<path>` ลองตีความอาร์กิวเมนต์เป็นชื่อไฟล์ด้วย จนเกินขีดจำกัด 260 ตัวอักษร ตอนนี้ทุกคำสั่ง `git show <rev>:<path>` ลงท้ายด้วย `--` และถ้า error ไม่ใช่เรื่องไฟล์ไม่มีอยู่ จะรายงานตามจริง
- `evals/scaffold.mjs` (ใช้โดย eval และ A/B harness) เดิมข้าม folder `data/` ของทุกตัวอย่าง ซึ่งเป็นที่เก็บ CSV ขาเข้าของ `sample-generic` ทำให้ verify ในสำเนาที่ scaffold ไม่มีวันผ่าน ตอนนี้ข้ามเฉพาะไฟล์ฐานข้อมูลใน `data/`
- ไฟล์ที่ใหญ่เกิน 1 MB ที่มีกฎครอบคลุม จะถูกแจ้งชื่อเป็น warning แทนการข้ามเงียบ ๆ
- การ list ไฟล์ของโปรเจกต์ไม่ stat ทีละไฟล์แล้ว (ตัวอ่านจะข้ามสิ่งที่ไม่ใช่ไฟล์ปกติเอง) การสแกน guard ทั้ง repo ขนาด 5,000 ไฟล์จึงกลับมาเร็วเท่าก่อนเปลี่ยนเรื่อง gitignore ซึ่งเคยช้าลงราว 20%
- Monorepo: โปรเจกต์ที่อยู่ใน subfolder เดิม `init` เขียน workflow ไว้ใน subfolder นั้น ซึ่ง GitHub ไม่เคยรัน ตอนนี้จะเขียน `.github/workflows/stack-agent-<folder>.yml` ไว้ที่ root ของ repository โดยรันใน folder ของโปรเจกต์ และรันเฉพาะเมื่อไฟล์ของโปรเจกต์เปลี่ยน `init --check` จะแจ้งถ้ามี workflow ค้างใน subfolder ถ้าเคยติดตั้งโปรเจกต์ใน subfolder ไว้ ให้รัน `init` ซ้ำแล้วลบไฟล์เก่า
- เครื่องมือที่คัดลอกไว้ซึ่งต่างจากของ plugin จะถูกแจ้งชื่อตอนเริ่มทุก session พร้อมคำสั่งที่ใช้อัปเดต เพราะ hook รัน script ของ plugin ส่วน CI รัน `.stack-agent/bin` ชุดที่เก่าจึงทำให้ทั้งสองตัดสินต่างกันโดยไม่มีใครรู้
- หลักฐานบันทึก `fingerprintVersion` ถ้าหลักฐานมาจาก `verify.mjs` ที่คำนวณ fingerprint ต่างจาก hook Stop hook จะบอกตามนั้น แทนการบอกว่า "โค้ดเปลี่ยน"
- Monorepo: `guard.mjs --compare-ref` เดิมอ่าน config และ baseline เก่าจาก root ของ repository ในโปรเจกต์ที่อยู่ใน subfolder จึงหาไม่เจอ และผ่านแม้กฎถูกลบหรือ baseline โตขึ้น ตอนนี้อ่านจาก folder ของโปรเจกต์แล้ว

## 0.2.0 (2026-10-23)

เวอร์ชันค้างอยู่ที่ 0.1.0 ตั้งแต่ commit แรก (`5d3ee7b`, 2026-10-18) จนถึง `0cfc5c1` (2026-10-21) ไฟล์ `.stack-agent/bin/VERSION` ทุกไฟล์ที่เขียนในช่วงนั้นจึงบอก `0.1.0` ไม่ว่าโค้ดที่ได้ไปจะเป็นชุดไหน รุ่นนี้รวมการเปลี่ยนแปลงทั้งหมดในช่วงนั้น

### อัปเกรดจาก 0.1.0

- รัน `node <path-to-Stack_Agent>/scripts/init.mjs .` ซ้ำเพื่ออัปเดต `.stack-agent/bin/` คำสั่งนี้เขียนทับเฉพาะเครื่องมือ ไม่แตะ config ของคุณ ถ้ายังไม่ได้รัน `init.mjs --check` จะขึ้นเครื่องมือแต่ละตัวว่า `outdated`
- Stop hook บล็อกเป็นค่าเริ่มต้นแล้ว (`"stopHook": "block"`) จนกว่าหลักฐานของ verify จะตรงกับโค้ด แทนการเตือนครั้งเดียวแบบเดิม ถ้าต้องการแบบเดิมให้ตั้ง `"stopHook": "remind"` ใน `verify.json`
- กฎ import นับทีละชื่อที่ import แล้ว (baseline version 2) baseline เก่ายังใช้ได้และจะพิมพ์ข้อความแนะนำ ให้อัปเกรดด้วย `guard.mjs --update-baseline` บน tree ที่สะอาด แยกเป็น commit ของมันเอง
- template ของ CI มี job `verify` แล้ว (ตั้งแต่ `ab50446`) job นี้จะแดงจนกว่าจะกรอก `verify.json` และแทนขั้นติดตั้งที่เป็น `EDIT ME` workflow ที่ `init` สร้างไว้ก่อน commit นั้นไม่มี job นี้ เพราะ `init` ไม่เขียนทับ workflow ที่มีอยู่แล้ว
- config ของ guard ที่สร้างก่อน `da75cea` ไม่มีกฎ `no-debug-tags` คำสั่ง `init.mjs --check` จะบอกชื่อกฎนี้ ให้คัดลอกจาก preset หรือใส่ไว้ใน `"declinedRules"`

### ใช้ได้กับทุกโปรเจกต์

- มี preset `generic` (ค่าเริ่มต้น), `backend-http`, `frontend-web`, `cli` และ `library` แต่ละตัวมีตัวอย่างใน `examples/` ที่ผ่าน guard และ verify เต็มของตัวเอง `init` บันทึก preset ไว้และไม่ยอมให้ผสม preset อื่นเข้ามา
- verify รัน command check ได้ควบคู่กับ HTTP check และ `test`, `server` และ check รับ `args` เพื่อรันโปรแกรมโดยไม่ผ่าน shell
- กฎ import ของ guard อ่าน Python ได้ นอกจาก JS/TS

### ผูกการตรวจงานไว้กับโค้ด

- หลักฐานบันทึก fingerprint ของโค้ดที่ทดสอบ ไฟล์ที่การรันเปลี่ยนเองจะถูกระบุ และทำให้หลักฐานนั้นใช้ไม่ได้
- ขั้น against: หลังการรันครบที่ผ่าน check ใหม่ และชุดเทสเมื่อไฟล์เทสเปลี่ยน จะถูกรันกับโค้ดก่อนการแก้ อย่างน้อยหนึ่งตัวต้อง fail ที่นั่น
- SessionStart hook บันทึกจุดเริ่มของ session การ commit ระหว่างทางจึงไม่ซ่อนการแก้ และการแก้ `verify.json` กลาง session ก็ปิด Stop hook ไม่ได้
- `verify.mjs --skip "<reason>"` หรือข้อความสุดท้ายที่ลงท้ายด้วย `stack-agent-skip: <reason>` บันทึกเหตุผลที่ตรวจงานไม่ได้
- `verify.mjs --evidence-status` บอกว่าหลักฐานล่าสุดตรงกับโค้ดหรือไม่ โดยไม่รันอะไร

### Guard และ hook

- ratchet นับทีละชื่อที่ import (baseline version 2)
- ทุก preset มีกฎ `no-debug-tags` และตัวเลือก `"onEdit": "skip"` ทำให้ hook หลังแก้ไฟล์ข้ามกฎนั้น
- `init --check` รายงานเครื่องมือที่คัดลอกไว้ซึ่งต่างจากของ plugin และกฎสากลที่โปรเจกต์ยังไม่มี ส่วน `"declinedRules"` ปิดการแจ้งเรื่องหลัง
- hook ของ shell ถามคนก่อนเพิ่มเติม สำหรับ `git branch -D` การบังคับย้าย branch การลบโฟลเดอร์ `.github` และ inline script (`node -e`, `python -c`, `path.join`) ที่เขียนไฟล์ที่ป้องกันไว้
- สแกนทั้ง repo เร็วขึ้น: cache glob และ resolve เป้าหมายของ import ครั้งเดียวต่อการรัน

### รีวิว

- skill `sample-review` อ่านแต่ละ commit ที่สุ่มได้ใน checkout ของมันเอง (`review-worktree.mjs`)
- agent `reviewer` รายงาน candidate เป็น JSON ส่วน agent ใหม่ `finding-verifier` ตัดสินเป็น `confirmed`, `hardening`, `needs_validation` หรือ `rejected` โดยไม่เห็นหลักฐานของ reviewer และ `review-findings.mjs` ตรวจไฟล์เหล่านั้น
- แกนรีวิวแบบ `spec` เทียบการแก้กับ commit message หรือไฟล์ spec
- review log ทำหน้าที่เป็น ledger ด้วย commit ที่รีวิวแล้วจึงถูกข้าม

### Skill

- skill ใหม่ `debug`: repro คือ verify check หรือเทสที่ต้อง fail ก่อน
- `reflect` และ `correct` รับเฉพาะการแก้ที่มีสิ่งที่สังเกตเห็นจริงยกมาอ้าง

### การวัดผล

- A/B harness `scripts/ab/` (`npm run ab`) แยกสภาพแวดล้อมแต่ละรอบ ให้คะแนนด้วย script และมี 14 task ผลอยู่ใน [docs/th/design-notes.md](docs/th/design-notes.md)
- `ci.yml` รันบน Linux และ Windows ด้วย Node 22 และ 24

## 0.1.0 (2026-10-18)

รุ่นแรก (`5d3ee7b`) สำหรับ repo ฝั่ง backend: `verify.mjs`, `guard.mjs` พร้อม baseline แบบ ratchet, `api-map.mjs`, `init.mjs`, `sample-commits.mjs`, hook, skill 9 ตัว, agent `judge` และ `reviewer`, eval 4 case และ `examples/sample-backend`
