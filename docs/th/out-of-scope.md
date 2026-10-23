# สิ่งที่ไม่ทำ

ไอเดียที่ Stack Agent ตัดสินใจไม่รับ พร้อมเหตุผล `design-notes.md` อธิบายว่าแต่ละส่วนมีไว้ทำไม ส่วนหน้านี้อธิบายว่าทำไมบางอย่างถึงไม่มี จะได้ไม่ต้องถกคำขอเดิมซ้ำ ถ้าคุณ fork Stack Agent ไปแล้วทีมอยากได้ข้อใดข้อหนึ่งก็ทำได้เลย เหตุผลด้านล่างเป็นเหตุผลของ template ที่ต้องใช้ได้กับทุกโปรเจค ไม่ได้เกี่ยวกับโปรเจคของคุณ

ไอเดียจากทอล์กต้นทางที่ไม่ได้ทำ (auto-merge, การคุมเบราว์เซอร์, cloud agent, กฎเฉพาะของ codebase เดียว) อยู่ในหัวข้อ "ที่ตั้งใจไม่ทำ" ของ [design-notes.md](design-notes.md) หน้านี้เก็บไอเดียที่มาจากโปรเจคอื่น แต่ละข้อบอกไอเดีย ที่มา เหตุผล และสิ่งที่ Stack Agent ทำแทน ถ้าจะเปิดข้อใดขึ้นมาใหม่ ให้แสดงว่ามีอะไรเปลี่ยน: ปัญหาที่วัดได้ซึ่งการออกแบบตอนนี้จับไม่ได้ หรือเหตุผลด้านล่างที่ไม่จริงแล้ว

[English](../out-of-scope.md)

## prompt ตั้งต้นที่ฉีดเข้าทุก session

- **ที่มา:** obra/superpowers, `skills/using-superpowers` ที่ SessionStart hook โหลดเข้ามา ("If you think there is even a 1% chance a skill might apply… you ABSOLUTELY MUST invoke")
- **ทำไมไม่ทำ:** บังคับด้วยคำพูดและเสีย token ทุก session แม้ใน session ที่ไม่มี skill ไหนเกี่ยว superpowers เองก็ต้องตัดให้สั้นลง (release notes v6.1.0) กฎของ Stack Agent ต้องยังมีผลแม้ agent จะไม่ทำตามคำพูด
- **ทำอะไรแทน:** hook และ script ที่หยุด agent ได้จริง (Stop hook, hook ของ shell และการแก้ไฟล์, verify, guard) ซึ่งทำงานเฉพาะในโปรเจคที่ติดตั้ง Stack Agent และ description ของ skill ที่บอกว่าใช้เมื่อไร ซึ่งวัดผลด้วย A/B และ eval case

## วิธีพัฒนาแบบเดียวสำหรับทุกโปรเจค

- **ที่มา:** obra/superpowers (brainstorm, วางแผน, worktree, ให้ subagent ทำ, TDD แบบเคร่งที่ลบโค้ดที่เขียนก่อนเทส, จบ branch ด้วย merge หรือ PR)
- **ทำไมไม่ทำ:** template สำหรับทุกโปรเจคเลือกวิธีทำงานแบบเดียวให้ไม่ได้ แต่ละทีมทำ TDD, branch และรีวิวไม่เหมือนกัน และ flow การ merge แบบตายตัวขัดกับการให้คนตัดสินใจเองว่าจะ commit เมื่อไร
- **ทำอะไรแทน:** check ที่ใช้ได้ไม่ว่าจะทำงานแบบไหน: verify กับขั้น against พิสูจน์ว่า check fail บนโค้ดเก่า, guard ไล่ขันกฎทีละขั้น และ Stop hook ขอเทสหรือ check เมื่อโค้ดเปลี่ยนแต่ไม่มีอะไรใหม่ตรวจ

## manifest และ shim สำหรับเครื่องมือ agent อื่น

- **ที่มา:** obra/superpowers (ราว 16 เครื่องมือ), mattpocock/skills (`agents/openai.yaml`, skills.sh)
- **ทำไมไม่ทำ:** สิ่งที่ Stack Agent บังคับส่วนใหญ่อยู่ใน hook ของ Claude Code ถ้า port ไปโดยไม่มี hook ที่เทียบเท่า ก็จะได้ skill ที่ไม่มีอะไรบังคับ แต่ดูเหมือนใช้ได้
- **ทำอะไรแทน:** script ที่ vendor ไว้ใน `.stack-agent/bin/` กับ workflow ของ CI เป็น Node ล้วน รันที่ไหนก็ได้ ส่วน hook กับ skill ใช้ได้เฉพาะ Claude Code

## skill ที่ผูกกับ issue tracker

- **ที่มา:** mattpocock/skills (`triage`, `to-tickets`, `to-spec`, `wayfinder`, `implement-spec`, `setup-matt-pocock-skills`) ซึ่งอ่านเขียน issue ผ่าน `gh` หรือ `glab` และเอกสาร tracker ของแต่ละ repo
- **ทำไมไม่ทำ:** Stack Agent ไม่สมมติว่ามี tracker, host หรือ CLI อื่นนอกจาก git กับ Node
- **ทำอะไรแทน:** spec มาจาก commit message หรือไฟล์ (`sample-review` และ source แบบ `spec` ของ reviewer)

## เครื่องมือที่ต้อง `npm install`

- **ที่มา:** Changesets (การออกรุ่นของ mattpocock/skills), dependency-cruiser (`setup-ts-deep-modules`), harness eval ชื่อ Quorum (obra/superpowers: bun, tmux, container)
- **ทำไมไม่ทำ:** repo ปลายทาง vendor script ไว้ใน `.stack-agent/bin/` และ CI รันโดยไม่ต้องติดตั้งอะไร dependency ตัวเดียวก็ทำให้ข้อนี้พังทุกโปรเจค และ Changesets เขียน changelog ได้แค่ภาษาอังกฤษ ขณะที่ Stack Agent มีสองภาษา
- **ทำอะไรแทน:** script Node ESM ที่ไม่มี dependency, กฎ import ของ guard กับ `extends` สำหรับขอบเขตของ module, harness A/B ใน `scripts/ab/` และ `claude plugin eval` สำหรับ eval case

## แก้จุดที่ผิดกฎเดิมใน sample backend

- **ที่มา:** ใครก็ตามที่อ่าน `examples/sample-backend/src/modules/reports/controller.js`
- **ทำไมไม่ทำ:** การละเมิด `module-boundary` ในไฟล์นั้นคือ baseline ที่ตัวอย่าง ratchet และเทสใช้อยู่
- **ทำอะไรแทน:** เก็บไว้ใน `.stack-agent/guard-baseline.json` และการละเมิดใหม่ยัง fail เหมือนเดิม
