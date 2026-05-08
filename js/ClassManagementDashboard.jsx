import React, { useMemo, useState } from 'react';

const classCards = [
  {
    id: '11',
    title: 'Class 11',
    subjects: ['Biology', 'Chemistry', 'Physics'],
    totalSubjects: 4
  },
  {
    id: '12',
    title: 'Class 12',
    subjects: ['Biology', 'Chemistry', 'Physics'],
    totalSubjects: 4
  }
];

const studentsByClass = {
  '11': [
    { roll: '11-01', name: 'Ananya Kapoor' },
    { roll: '11-02', name: 'Rohan Singh' },
    { roll: '11-03', name: 'Meera Patel' },
    { roll: '11-04', name: 'Arjun Das' }
  ],
  '12': [
    { roll: '12-01', name: 'Priya Nair' },
    { roll: '12-02', name: 'Vivaan Iyer' },
    { roll: '12-03', name: 'Simran Kaur' },
    { roll: '12-04', name: 'Kabir Shah' }
  ]
};

const theme = {
  background: '#0f1123',
  surface: '#161931',
  surfaceSoft: '#1c2140',
  surfaceBorder: '#292f57',
  text: '#f5f7ff',
  muted: '#9aa3c7',
  primary: '#8b5cf6',
  primarySoft: 'rgba(139, 92, 246, 0.16)',
  buttonText: '#ffffff'
};

const ClassManagementDashboard = () => {
  const [activeClassId, setActiveClassId] = useState(null);

  const activeStudents = useMemo(() => {
    return activeClassId ? studentsByClass[activeClassId] || [] : [];
  }, [activeClassId]);

  return (
    <div style={{ minHeight: '100vh', background: theme.background, color: theme.text, fontFamily: 'Inter, system-ui, sans-serif', padding: '32px' }}>
      <div style={{ maxWidth: 1200, margin: '0 auto' }}>
        <header style={{ marginBottom: 32 }}>
          <p style={{ margin: 0, color: theme.muted, letterSpacing: '0.16em', fontSize: '0.82rem', textTransform: 'uppercase' }}>
            Class Management
          </p>
          <h1 style={{ margin: '12px 0 0', fontSize: '2rem', lineHeight: 1.1 }}>Class 11 &amp; Class 12 Dashboard</h1>
        </header>

        <div style={{ display: 'grid', gap: 24, gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' }}>
          {classCards.map((card) => (
            <div key={card.id} style={{ borderRadius: 28, background: theme.surface, border: `1px solid ${theme.surfaceBorder}`, padding: 24, boxShadow: '0 24px 60px rgba(15, 23, 42, 0.16)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                <div>
                  <span style={{ display: 'inline-flex', padding: '10px 16px', borderRadius: 999, background: 'linear-gradient(135deg, rgba(139, 92, 246, 0.22), rgba(99, 102, 241, 0.22))', color: theme.primary, fontWeight: 700, fontSize: '0.95rem' }}>
                    {card.title}
                  </span>
                </div>
                <span style={{ color: theme.muted, fontSize: '0.92rem' }}>{card.totalSubjects} subjects</span>
              </div>

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 24 }}>
                {card.subjects.map((subject) => (
                  <span key={subject} style={{ padding: '10px 14px', borderRadius: 999, background: theme.surfaceSoft, border: `1px solid ${theme.surfaceBorder}`, fontSize: '0.93rem', color: theme.text }}>
                    {subject}
                  </span>
                ))}
              </div>

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                <button
                  type="button"
                  onClick={() => setActiveClassId(card.id)}
                  style={{ minWidth: 140, borderRadius: 14, border: 'none', background: theme.primary, color: theme.buttonText, padding: '14px 18px', fontWeight: 700, cursor: 'pointer', boxShadow: '0 12px 24px rgba(139, 92, 246, 0.2)' }}
                >
                  View Students
                </button>
                <button
                  type="button"
                  style={{ minWidth: 140, borderRadius: 14, border: `1px solid ${theme.primary}`, background: 'transparent', color: theme.primary, padding: '14px 18px', fontWeight: 700, cursor: 'pointer' }}
                >
                  Attendance
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {activeClassId && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 50,
            background: 'rgba(15, 17, 35, 0.82)',
            display: 'grid',
            placeItems: 'center',
            padding: 24
          }}
        >
          <div style={{ width: '100%', maxWidth: 680, background: theme.surface, borderRadius: 28, border: `1px solid ${theme.surfaceBorder}`, boxShadow: '0 32px 80px rgba(15, 23, 42, 0.3)', overflow: 'hidden' }}>
            <div style={{ padding: '24px 28px 18px', borderBottom: `1px solid ${theme.surfaceBorder}` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 }}>
                <div>
                  <p style={{ margin: 0, color: theme.muted, textTransform: 'uppercase', letterSpacing: '0.14em', fontSize: '0.78rem' }}>Registered students</p>
                  <h2 style={{ margin: '10px 0 0', fontSize: '1.6rem' }}>Class {activeClassId} Students</h2>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveClassId(null)}
                  style={{ background: 'transparent', border: 'none', color: theme.muted, fontSize: '1.5rem', cursor: 'pointer' }}
                  aria-label="Close student modal"
                >
                  ×
                </button>
              </div>
            </div>

            <div style={{ padding: 24, display: 'grid', gap: 16 }}>
              {activeStudents.length ? (
                activeStudents.map((student) => (
                  <div key={student.roll} style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 12, alignItems: 'center', padding: 18, borderRadius: 20, background: theme.surfaceSoft, border: `1px solid ${theme.surfaceBorder}` }}>
                    <div>
                      <p style={{ margin: 0, color: theme.text, fontWeight: 700, fontSize: '1rem' }}>{student.name}</p>
                      <span style={{ color: theme.muted, fontSize: '0.92rem' }}>Roll Number: {student.roll}</span>
                    </div>
                    <span style={{ color: theme.primary, background: 'rgba(139, 92, 246, 0.12)', padding: '8px 12px', borderRadius: 999, fontSize: '0.9rem', fontWeight: 700 }}>
                      {activeClassId}
                    </span>
                  </div>
                ))
              ) : (
                <p style={{ margin: 0, color: theme.muted }}>No students registered for this class yet.</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ClassManagementDashboard;
