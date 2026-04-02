'use client';

export default function AppealButton() {
  return (
    <button
      style={{
        backgroundColor: '#0070f3',
        color: 'white',
        padding: '0.6rem 1.2rem',
        border: 'none',
        borderRadius: '0.3rem',
        cursor: 'pointer',
        marginBottom: '1rem',
      }}
      onClick={() => {
        window.location.href = '/check';
      }}
    >
      Check Your Appeal
    </button>
  );
}
