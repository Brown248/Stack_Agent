# บันทึกการเปลี่ยนแปลง

สิ่งที่เปลี่ยนในแต่ละรุ่นของ Stack Agent เวลาออกรุ่นใหม่ ให้เปลี่ยน `version` ใน `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` และ `package.json` พร้อมกัน แล้วเพิ่มหัวข้อในไฟล์นี้

[English](CHANGELOG.md)

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
