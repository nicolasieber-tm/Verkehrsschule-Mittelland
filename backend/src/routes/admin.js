import { requireAuth } from '../middleware/auth.js';
import {
  listCourses, getCourse, createCourse, updateCourse,
  setCourseStatus, deleteCourse,
  courseInputSchema, parseSessionsFromForm,
  utcToZurichLocalInput, formatZurich,
} from '../services/courses.js';
import {
  listRegistrations, getRegistration, updateRegistration,
  cancelRegistration, anonymizeRegistration, hardDeleteRegistration,
  registrationsToCsv, editInputSchema,
} from '../services/admin-registrations.js';
import {
  listRooms, getRoom, createRoom, updateRoom,
  archiveRoom, restoreRoom, deleteRoom, roomInputSchema,
} from '../services/rooms.js';

export async function adminRoutes(app) {

  // ---- Dashboard ----
  app.get('/', requireAuth(async (req, reply) => {
    const upcoming = await app.pg.query(
      `select * from courses where status='open' and starts_at > now() order by starts_at asc limit 5`
    );
    const recentRegs = await app.pg.query(
      `select r.*, c.course_no, c.location from registrations r
        join courses c on c.id = r.course_id
        order by r.created_at desc limit 10`
    );
    return reply.view('dashboard', {
      csrfToken: reply.generateCsrf(),
      currentAdmin: req.admin,
      active: 'dashboard',
      upcoming: upcoming.rows,
      recentRegs: recentRegs.rows,
      formatZurich,
    });
  }));

  // ---- Courses list ----
  app.get('/courses', requireAuth(async (req, reply) => {
    const courses = await listCourses(app.pg);
    return reply.view('courses/list', {
      csrfToken: reply.generateCsrf(),
      currentAdmin: req.admin,
      active: 'courses',
      courses,
      success: req.query.created ? 'Kurs angelegt.' : (req.query.updated ? 'Kurs aktualisiert.' : null),
      formatZurich,
    });
  }));

  // ---- New course form ----
  app.get('/courses/new', requireAuth(async (req, reply) => {
    const rooms = (await listRooms(app.pg)).filter(r => !r.archived_at);
    return reply.view('courses/form', {
      csrfToken: reply.generateCsrf(),
      currentAdmin: req.admin,
      active: 'courses',
      course: null,
      form: { variant: 'classic', status: 'open', sessions: [{}] },
      rooms,
      error: null,
    });
  }));

  // ---- Create course ----
  app.post('/courses', requireAuth(async (req, reply) => {
    const sessions = parseSessionsFromForm(req.body);
    // Combine split date+time fields if present (admin form uses two inputs for UX)
    const combinedStartsAt = req.body.starts_at_date && req.body.starts_at_time
      ? `${req.body.starts_at_date}T${req.body.starts_at_time}`
      : req.body.starts_at;
    const combinedDeadline = req.body.registration_deadline_date && req.body.registration_deadline_time
      ? `${req.body.registration_deadline_date}T${req.body.registration_deadline_time}`
      : (req.body.registration_deadline || null);
    const input = {
      ...req.body, sessions,
      starts_at: combinedStartsAt,
      registration_deadline: combinedDeadline,
    };
    const parsed = courseInputSchema.safeParse(input);
    if (!parsed.success) {
      const rooms = (await listRooms(app.pg)).filter(r => !r.archived_at);
      return reply.view('courses/form', {
        csrfToken: reply.generateCsrf(), currentAdmin: req.admin, active: 'courses',
        course: null, form: input, rooms,
        error: 'Bitte alle Felder korrekt ausfüllen. ' + parsed.error.issues.map(i => i.message).join(' / '),
      });
    }
    try {
      const { id } = await createCourse(app.pg, parsed.data);
      return reply.redirect(`/admin/courses/${id}?updated=1`);
    } catch (err) {
      const rooms = (await listRooms(app.pg)).filter(r => !r.archived_at);
      return reply.view('courses/form', {
        csrfToken: reply.generateCsrf(), currentAdmin: req.admin, active: 'courses',
        course: null, form: input, rooms, error: err.userMessage || 'Fehler beim Anlegen.',
      });
    }
  }));

  // ---- Edit course form ----
  app.get('/courses/:id', requireAuth(async (req, reply) => {
    const course = await getCourse(app.pg, Number(req.params.id));
    if (!course) return reply.code(404).send('Kurs nicht gefunden');
    const rooms = (await listRooms(app.pg)).filter(r => !r.archived_at || r.id === course.room_id);
    const form = {
      ...course,
      starts_at: utcToZurichLocalInput(course.starts_at),
      registration_deadline: utcToZurichLocalInput(course.registration_deadline),
      sessions: Array.isArray(course.sessions) ? course.sessions : [],
    };
    return reply.view('courses/form', {
      csrfToken: reply.generateCsrf(),
      currentAdmin: req.admin, active: 'courses',
      course, form, rooms,
      error: req.query.error || null,
    });
  }));

  // ---- Update course ----
  app.post('/courses/:id', requireAuth(async (req, reply) => {
    const id = Number(req.params.id);
    const course = await getCourse(app.pg, id);
    if (!course) return reply.code(404).send('Kurs nicht gefunden');
    const sessions = parseSessionsFromForm(req.body);
    // Combine split date+time fields if present (admin form uses two inputs for UX)
    const combinedStartsAt = req.body.starts_at_date && req.body.starts_at_time
      ? `${req.body.starts_at_date}T${req.body.starts_at_time}`
      : req.body.starts_at;
    const combinedDeadline = req.body.registration_deadline_date && req.body.registration_deadline_time
      ? `${req.body.registration_deadline_date}T${req.body.registration_deadline_time}`
      : (req.body.registration_deadline || null);
    const input = {
      ...req.body, sessions,
      starts_at: combinedStartsAt,
      registration_deadline: combinedDeadline,
    };
    const parsed = courseInputSchema.safeParse(input);
    if (!parsed.success) {
      const rooms = (await listRooms(app.pg)).filter(r => !r.archived_at || r.id === course.room_id);
      return reply.view('courses/form', {
        csrfToken: reply.generateCsrf(), currentAdmin: req.admin, active: 'courses',
        course, form: input, rooms,
        error: 'Bitte alle Felder korrekt ausfüllen. ' + parsed.error.issues.map(i => i.message).join(' / '),
      });
    }
    try {
      await updateCourse(app.pg, id, parsed.data);
      return reply.redirect(`/admin/courses/${id}?updated=1`);
    } catch (err) {
      const rooms = (await listRooms(app.pg)).filter(r => !r.archived_at || r.id === course.room_id);
      return reply.view('courses/form', {
        csrfToken: reply.generateCsrf(), currentAdmin: req.admin, active: 'courses',
        course, form: input, rooms, error: err.userMessage || 'Fehler beim Speichern.',
      });
    }
  }));

  // ---- Delete (only if no registrations) ----
  app.post('/courses/:id/delete', requireAuth(async (req, reply) => {
    const id = Number(req.params.id);
    try {
      await deleteCourse(app.pg, id);
      return reply.redirect('/admin/courses');
    } catch (err) {
      return reply.redirect(`/admin/courses/${id}?error=${encodeURIComponent(err.userMessage || 'Fehler')}`);
    }
  }));

  // ---- Quick status changes ----
  app.post('/courses/:id/close', requireAuth(async (req, reply) => {
    await setCourseStatus(app.pg, Number(req.params.id), 'closed');
    return reply.redirect(`/admin/courses/${req.params.id}?updated=1`);
  }));
  app.post('/courses/:id/archive', requireAuth(async (req, reply) => {
    await setCourseStatus(app.pg, Number(req.params.id), 'archived');
    return reply.redirect(`/admin/courses/${req.params.id}?updated=1`);
  }));
  app.post('/courses/:id/reopen', requireAuth(async (req, reply) => {
    await setCourseStatus(app.pg, Number(req.params.id), 'open');
    return reply.redirect(`/admin/courses/${req.params.id}?updated=1`);
  }));

  // ============= REGISTRATIONS =============

  // All registrations across all courses
  app.get('/registrations', requireAuth(async (req, reply) => {
    const rows = await listRegistrations(app.pg);
    return reply.view('registrations/list', {
      csrfToken: reply.generateCsrf(),
      currentAdmin: req.admin, active: 'registrations',
      registrations: rows, course: null,
      success: null, error: null,
      formatZurich,
    });
  }));

  // Registrations for one course
  app.get('/courses/:id/registrations', requireAuth(async (req, reply) => {
    const courseId = Number(req.params.id);
    const course = await getCourse(app.pg, courseId);
    if (!course) return reply.code(404).send('Kurs nicht gefunden');
    const rows = await listRegistrations(app.pg, { courseId });
    return reply.view('registrations/list', {
      csrfToken: reply.generateCsrf(),
      currentAdmin: req.admin, active: 'courses',
      registrations: rows, course,
      success: req.query.success || null,
      error: req.query.error || null,
      formatZurich,
    });
  }));

  // CSV export per course
  app.get('/courses/:id/registrations.csv', requireAuth(async (req, reply) => {
    const courseId = Number(req.params.id);
    const course = await getCourse(app.pg, courseId);
    if (!course) return reply.code(404).send('Kurs nicht gefunden');
    const rows = await listRegistrations(app.pg, { courseId });
    const csv = registrationsToCsv(rows);
    reply.header('Content-Type', 'text/csv; charset=utf-8');
    reply.header('Content-Disposition', `attachment; filename="anmeldungen-${course.course_no}.csv"`);
    return reply.send('﻿' + csv); // BOM for Excel
  }));

  // View / edit form
  app.get('/registrations/:id', requireAuth(async (req, reply) => {
    const reg = await getRegistration(app.pg, Number(req.params.id));
    if (!reg) return reply.code(404).send('Anmeldung nicht gefunden');
    return reply.view('registrations/form', {
      csrfToken: reply.generateCsrf(),
      currentAdmin: req.admin, active: 'registrations',
      reg,
      success: req.query.success || null,
      error: req.query.error || null,
      formatZurich,
    });
  }));

  // Update notes/paid
  app.post('/registrations/:id', requireAuth(async (req, reply) => {
    const id = Number(req.params.id);
    const reg = await getRegistration(app.pg, id);
    if (!reg) return reply.code(404).send('Anmeldung nicht gefunden');
    const parsed = editInputSchema.safeParse({
      paid: req.body.paid,
      admin_notes: req.body.admin_notes,
    });
    if (!parsed.success) {
      return reply.redirect(`/admin/registrations/${id}?error=${encodeURIComponent('Ungültige Eingabe.')}`);
    }
    await updateRegistration(app.pg, id, parsed.data);
    return reply.redirect(`/admin/registrations/${id}?success=${encodeURIComponent('Gespeichert.')}`);
  }));

  // Cancel
  app.post('/registrations/:id/cancel', requireAuth(async (req, reply) => {
    const id = Number(req.params.id);
    const changed = await cancelRegistration(app.pg, id);
    const msg = changed ? 'Anmeldung storniert, Platz wieder frei.' : 'Anmeldung war bereits storniert.';
    return reply.redirect(`/admin/registrations/${id}?success=${encodeURIComponent(msg)}`);
  }));

  // Anonymize (DSG)
  app.post('/registrations/:id/anonymize', requireAuth(async (req, reply) => {
    const id = Number(req.params.id);
    await anonymizeRegistration(app.pg, id);
    return reply.redirect(`/admin/registrations/${id}?success=${encodeURIComponent('Datensatz anonymisiert und storniert.')}`);
  }));

  // Hard delete (only when cancelled)
  app.post('/registrations/:id/hard-delete', requireAuth(async (req, reply) => {
    const id = Number(req.params.id);
    const reg = await getRegistration(app.pg, id);
    if (!reg) return reply.redirect('/admin/registrations');
    try {
      await hardDeleteRegistration(app.pg, id);
      return reply.redirect(`/admin/courses/${reg.course_id}/registrations?success=${encodeURIComponent('Anmeldung gelöscht.')}`);
    } catch (err) {
      return reply.redirect(`/admin/registrations/${id}?error=${encodeURIComponent(err.userMessage || 'Fehler')}`);
    }
  }));

  // ============= ROOMS =============

  app.get('/rooms', requireAuth(async (req, reply) => {
    const rooms = await listRooms(app.pg, { includeArchived: true });
    return reply.view('rooms/list', {
      csrfToken: reply.generateCsrf(),
      currentAdmin: req.admin, active: 'rooms',
      rooms,
      success: req.query.created ? 'Raum angelegt.' : (req.query.updated ? 'Raum aktualisiert.' : null),
    });
  }));

  app.get('/rooms/new', requireAuth(async (req, reply) => {
    return reply.view('rooms/form', {
      csrfToken: reply.generateCsrf(),
      currentAdmin: req.admin, active: 'rooms',
      room: null, form: {}, error: null,
    });
  }));

  app.post('/rooms', requireAuth(async (req, reply) => {
    const parsed = roomInputSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.view('rooms/form', {
        csrfToken: reply.generateCsrf(), currentAdmin: req.admin, active: 'rooms',
        room: null, form: req.body,
        error: 'Bitte alle Felder korrekt ausfüllen. ' + parsed.error.issues.map(i => i.message).join(' / '),
      });
    }
    const { id } = await createRoom(app.pg, parsed.data);
    return reply.redirect(`/admin/rooms/${id}?updated=1`);
  }));

  app.get('/rooms/:id', requireAuth(async (req, reply) => {
    const id = Number(req.params.id);
    const rooms = await listRooms(app.pg, { includeArchived: true });
    const room = rooms.find(r => r.id === id);
    if (!room) return reply.code(404).send('Raum nicht gefunden');
    return reply.view('rooms/form', {
      csrfToken: reply.generateCsrf(),
      currentAdmin: req.admin, active: 'rooms',
      room, form: room, error: null,
    });
  }));

  app.post('/rooms/:id', requireAuth(async (req, reply) => {
    const id = Number(req.params.id);
    const room = await getRoom(app.pg, id);
    if (!room) return reply.code(404).send('Raum nicht gefunden');
    const parsed = roomInputSchema.safeParse(req.body);
    if (!parsed.success) {
      const rooms = await listRooms(app.pg, { includeArchived: true });
      const roomWithCount = rooms.find(r => r.id === id) || room;
      return reply.view('rooms/form', {
        csrfToken: reply.generateCsrf(), currentAdmin: req.admin, active: 'rooms',
        room: roomWithCount, form: req.body,
        error: 'Bitte alle Felder korrekt ausfüllen. ' + parsed.error.issues.map(i => i.message).join(' / '),
      });
    }
    await updateRoom(app.pg, id, parsed.data);
    return reply.redirect(`/admin/rooms/${id}?updated=1`);
  }));

  app.post('/rooms/:id/archive', requireAuth(async (req, reply) => {
    await archiveRoom(app.pg, Number(req.params.id));
    return reply.redirect(`/admin/rooms/${req.params.id}?updated=1`);
  }));

  app.post('/rooms/:id/restore', requireAuth(async (req, reply) => {
    await restoreRoom(app.pg, Number(req.params.id));
    return reply.redirect(`/admin/rooms/${req.params.id}?updated=1`);
  }));

  app.post('/rooms/:id/delete', requireAuth(async (req, reply) => {
    const id = Number(req.params.id);
    try {
      await deleteRoom(app.pg, id);
      return reply.redirect('/admin/rooms');
    } catch (err) {
      return reply.redirect(`/admin/rooms/${id}?error=${encodeURIComponent(err.userMessage || 'Fehler')}`);
    }
  }));

  // Resend mail — actually re-send via Resend
  app.post('/registrations/:id/resend-mail', requireAuth(async (req, reply) => {
    const id = Number(req.params.id);
    const target = req.query.target === 'school' ? 'school' : 'participant';
    const col = target === 'school' ? 'school_mail_status' : 'participant_mail_status';
    // Reset status to 'pending' so the sender treats it as pending
    await app.pg.query(`update registrations set ${col}='pending', updated_at=now() where id=$1`, [id]);
    const { sendRegistrationMails } = await import('../services/mail.js');
    await sendRegistrationMails(app.pg, id, app.log);
    return reply.redirect(`/admin/registrations/${id}?success=${encodeURIComponent('Mail erneut versendet.')}`);
  }));
}
