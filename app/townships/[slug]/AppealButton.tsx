import Link from 'next/link';

export default function AppealButton() {
  return (
    <Link
      href="/check"
      style={{
        display: 'inline-block',
        backgroundColor: '#0070f3',
        color: 'white',
        padding: '0.6rem 1.2rem',
        border: 'none',
        borderRadius: '0.3rem',
        cursor: 'pointer',
        marginBottom: '1rem',
        textDecoration: 'none',
      }}
    >
      Check Your Appeal
    </Link>
  );
}
