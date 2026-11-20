# Veradic walkthrough: voice-over script

Read each line as its own take and save it as `<file name>.wav` in one folder (for example `welcome.intro.wav`).
Natural pace is fine; the video re-times itself to your takes. You can reword a line: edit it in `scripts/walkthrough/script.py` so the captions match.

Then run: `python -m scripts.walkthrough.record --voiceover <your folder>`

## 1. Welcome to Veradic  (starts at 0:00)

**welcome.loop.wav**

Welcome to Veradic. Here's the whole idea in one breath. You assign homework, and students photograph their handwritten work. The AI grades it as a first pass. Then you review it and publish. No grade reaches a student until you publish it.

**welcome.queue.wav**

This is My Courses, your home base. Needs you today gathers every submission that's waiting on you, across all your classes. Flagged work comes first, then work that's past due and still needs your review. Click any row to jump straight to that student.

**welcome.courses.wav**

Further down are your courses, each showing how much is left to review.

**welcome.sidebar.wav**

On the left, Preview as student lets you see the app the way your students do. Video walkthrough brings back this video, and Report a problem sends a note straight to us.

## 2. Courses and sections  (starts at 0:44)

**courses.concept.wav**

A course is a class you teach, like Algebra I. Sections are the periods you teach it in, and each one has its own roster. You build homework once for the course, then assign it to any of its sections.

**courses.new.wav**

Let's make one. Click New Course, give it a name, pick the subject, and add a grade level if you like.

**courses.create.wav**

Create it, and it shows up in your list. Open it to set it up.

**courses.section.wav**

Now add a section for each period you teach. I'll call this one Period 2.

**courses.code.wav**

Every section gets its own join code the moment you create it.

## 3. Adding students  (starts at 1:17)

**students.code.wav**

The quickest way to add students is that join code. Click it to copy it, then put it up on the board. Students enter the code when they sign up, and they land in this section.

**students.invite.wav**

You can also invite students by email. Open Manage, paste in your list, and send. Each student gets an email with a link that brings them straight into the section.

**students.pending.wav**

Each invite waits under Pending invites until the student accepts. You can resend one, or revoke it if it went to the wrong address.

**students.close.wav**

Once everyone's in, close enrollment, so the code stops letting new students join. You can reopen it any time.

**students.regen.wav**

And if a code ever ends up somewhere it shouldn't, regenerate it. The old code stops working right away.

## 4. Units and materials  (starts at 2:00)

**materials.units.wav**

Materials live in units. Think of a unit as a chapter of your textbook. Every homework belongs to at least one unit, so it pays to set them up the way you teach.

**materials.new_unit.wav**

Click New Unit, and name it after the chapter. It appears in the list on the left, and clicking it opens the unit.

**materials.upload.wav**

Then upload what you teach from: textbook pages, worksheets, your own notes. Photos and PDFs both work.

**materials.why.wav**

When you have the AI write problems, you can point it at these files, so new problems match the way your class learns the material.

**materials.view.wav**

Hover over any file, and View opens it, so you can check you uploaded the right pages.

## 5. Creating homework  (starts at 2:39)

**homework.list.wav**

The Homework tab sorts everything by what it needs from you: homework to grade, what's due this week, and what's finished.

**homework.filter.wav**

As the list grows, search it, or filter by status, section, or unit.

**homework.details.wav**

Click New homework. Step one is the details: a title, and the unit it belongs to.

**homework.due.wav**

Set a due date, and read the note underneath. The AI starts grading when that date passes.

**homework.policy.wav**

Pick a late policy, and choose sections. Leave sections empty to assign it to every section in the course.

**homework.generate.wav**

Step two is the problems. The AI can write new ones from your unit and your materials. You choose how many, and what to focus on. They land in a review queue for you to approve.

**homework.upload.wav**

Already have a worksheet? Switch to Upload, add photos or a PDF, and the AI copies the problems from it word for word.

**homework.grading.wav**

Step three is grading. Set the points, then add rules of your own, and common mistakes to watch for. On the right, you can read exactly how the AI will give full and partial credit.

**homework.review.wav**

Step four is one last look. Create and generate would start writing problems, so for this walkthrough, I'll save it as a draft instead.

**homework.editor.wav**

Saving opens the draft in the editor. Here's one that already has its problems, each with its points. Open Solution to check the answer key and the worked steps.

**homework.publish.wav**

When it looks right, Publish sends it out to the sections you chose.

**homework.preview.wav**

Before you do, Preview as student shows you exactly what your students will see, right down to the upload box. Anything you turn in here is a test run, and your students' work is untouched. Back to teacher view brings you home.

## 6. Reviewing AI grades  (starts at 4:14)

**grading.roster.wav**

Once homework is due, the AI grades each submission, and you review it. This is the grading page for one section. The roster puts what needs you on top. Needs your eyes is anything flagged, or where the AI wasn't sure. Below that, AI confident.

**grading.open.wav**

Let's open Zoe. Her photographed work is on the right. Each problem shows her answer, the answer key, and the AI's grade, with how confident it is.

**grading.confident.wav**

Problems the AI is confident about collapse to a quick confirm, and one button confirms them all. Even those aren't accepted until you say so. The one it was unsure about stays open.

**grading.reason.wav**

The AI wasn't sure about problem five, so it left it open. Its reasoning: her work finds x equals 2 and y equals 5, but she wrote the point backwards. It suggested no credit.

**grading.partial.wav**

That's a judgment call, and it's yours. I'll give partial credit. The feedback underneath is what Zoe sees once the grade is published, and you can edit it.

**grading.approve.wav**

Then approve it. The AI's grade is only ever a suggestion, and nothing is accepted automatically.

**grading.publish.wav**

To release grades, click Publish. Veradic tells you how many you haven't approved yet, and warns you about anything still flagged. I'll publish only the one I approved.

**grading.done.wav**

Zoe can now see her score and her feedback. Everyone else waits until you're ready.

## 7. The understanding check  (starts at 5:32)

**uc.why.wav**

After a student turns in work, Veradic asks them to explain it, in their own words, in a short conversation. It's there for learning. When a student is stuck, it helps them think it through.

**uc.never.wav**

It never accuses anyone. When an explanation doesn't line up with the work, it flags it for you to look at, and you decide what it means.

**uc.card.wav**

Here, Ava's answers were all correct, but she couldn't explain how she found the slope.

**uc.conversation.wav**

Open the conversation to read exactly what was said, and how long she took to reply.

**uc.resolve.wav**

Maybe she had an off day. Maybe it's worth a word after class. Either way, mark it reviewed, and pick an outcome. I'll choose Cleared.

**uc.after.wav**

Once it's resolved, it leaves your queue, and the record shows you reviewed it.

## 8. The gradebook  (starts at 6:18)

**grades.grid.wav**

The Grades tab is your gradebook: every student and every homework, one section at a time. Only published grades show a score, and missing work is never averaged in as a zero.

**grades.bands.wav**

The bar along the top shows how the section is spread: three students at eighty-five or above, two in the seventies, and two under seventy. A small dot marks a grade where you changed the AI's suggestion, like Zoe's.

**grades.attention.wav**

Needs attention narrows it to students averaging below seventy percent.

**grades.missing.wav**

Missing work shows who hasn't turned in something that's past due.

**grades.student.wav**

Click a name to see one student: their overall grade, what's missing, and how they're getting on with practice.

**grades.export.wav**

Back on the gradebook, Export CSV downloads this section's grades, ready to import into Canvas, Schoology or PowerSchool.

## 9. Practice and Student Insights  (starts at 7:06)

**pi.practice.wav**

Practice sets are ungraded. Students use them to work at a skill until it clicks. The quickest way to make one is to clone a homework.

**pi.clone.wav**

Pick the homework and the problems to practice, and the AI writes new versions of each for you to approve. I won't generate one now, so I'll close this.

**pi.insights.wav**

Student Insights shows which problems most of a section got wrong on each homework. It only counts grades you've approved or published.

**pi.sections.wav**

Each section gets its own view, since different periods often trip over different things. Pick a section up top, and a homework below it.

**pi.reteach.wav**

Here, every student in Period 3 missed problem six. It's already picked for a practice set, so reteaching it is one click away.

**pi.other.wav**

The rest of the homework is tucked under Other problems, if you want to add more to the set.

**pi.loop.wav**

That's the loop. Assign, let the AI take the first pass, review and publish, then reteach what the class missed. Thanks for watching.
