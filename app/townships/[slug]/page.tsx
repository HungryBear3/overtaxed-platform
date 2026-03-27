import { Metadata } from 'next';

type TownshipKey = 'bloom' | 'bremen' | 'calumet' | 'rich' | 'thornton' | 'worth';

const townships: Record<TownshipKey, { title: string; cities: string[] }> = {
  bloom: {
    title: 'Bloom Township',
    cities: ['Chicago Heights', 'Steger', 'Lynwood', 'Glenwood'],
  },
  bremen: {
    title: 'Bremen Township',
    cities: ['Midlothian', 'Oak Forest', 'Tinley Park', 'Orland Park'],
  },
  calumet: {
    title: 'Calumet Township',
    cities: ['Blue Island', 'Riverdale', 'Dolton', 'Harvey'],
  },
  rich: {
    title: 'Rich Township',
    cities: ['Matteson', 'Park Forest', 'Richton Park', 'Olympia Fields'],
  },
  thornton: {
    title: 'Thornton Township',
    cities: ['Harvey', 'Hazel Crest', 'Homewood', 'Flossmoor', 'South Holland'],
  },
  worth: {
    title: 'Worth Township',
    cities: ['Worth', 'Palos Hills', 'Oak Lawn', 'Chicago Ridge', 'Alsip'],
  },
};

export async function generateStaticParams() {
  return Object.keys(townships).map(slug => ({ slug }));
}

export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  const township = townships[params.slug as TownshipKey];
  return {
    title: `${township?.title || 'Township'} - OverTaxed Platform`,
  };
}

export default function Page({ params }: { params: { slug: string } }) {
  const { slug } = params;
  const township = townships[slug as TownshipKey];

  if (!township) {
    return <div>Township not found</div>;
  }

  return (
    <main style={{ padding: '1rem', fontFamily: 'Arial, sans-serif' }}>
      <h1>{township.title} 2026</h1>
      <div style={{ backgroundColor: 'green', color: 'white', padding: '0.3rem 0.6rem', width: 'fit-content', borderRadius: '0.4rem', marginBottom: '1rem' }}>
        Open for Appeals
      </div>

      <section>
        <h2>Cities</h2>
        <ul>
          {township.cities.map((city: string) => <li key={city}>{city}</li>)}
        </ul>
      </section>

      <section>
        <h2>Savings Stats</h2>
        <p>Average savings: $1,200/yr</p>
      </section>

      <section>
        <h2>3-Step Appeal Process</h2>
        <ol>
          <li>Review your tax bill</li>
          <li>File an appeal</li>
          <li>Receive updated assessment</li>
        </ol>
      </section>

      <section>
        <button style={{ backgroundColor: '#0070f3', color: 'white', padding: '0.6rem 1.2rem', border: 'none', borderRadius: '0.3rem', cursor: 'pointer', marginBottom: '1rem' }} onClick={() => {
          window.location.href = '/check';
        }}>
          Check Your Appeal
        </button>
      </section>

      <section>
        <h2>FAQs</h2>
        <ul>
          <li>How do I know if I should appeal my tax bill?</li>
          <li>What documents do I need for an appeal?</li>
          <li>How long does the appeal process take?</li>
        </ul>
      </section>

      <section>
        <a href="/townships">Back to Townships</a>
      </section>
    </main>
  );
}
