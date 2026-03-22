import Link from 'next/link'
import { getAllPosts } from '@/lib/blog'

export const metadata = {
  title: 'Blog | Overtaxed IL',
  description: 'Guides and resources for appealing your property tax assessment in Illinois.',
}

export default function BlogPage() {
  const posts = getAllPosts()

  return (
    <div className="max-w-3xl mx-auto px-4 py-16">
      <h1 className="text-3xl font-bold mb-2">Blog</h1>
      <p className="text-gray-500 mb-10">Guides and resources for appealing your property tax assessment in Illinois.</p>
      <div className="space-y-8">
        {posts.map((post) => (
          <article key={post.slug} className="border-b pb-8">
            <Link href={`/blog/${post.slug}`}>
              <h2 className="text-xl font-semibold hover:text-blue-600 transition-colors">{post.title}</h2>
            </Link>
            <p className="text-sm text-gray-400 mt-1">{new Date(post.date).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</p>
            <p className="text-gray-600 mt-2">{post.description}</p>
            <Link href={`/blog/${post.slug}`} className="text-blue-600 text-sm mt-3 inline-block hover:underline">
              Read more →
            </Link>
          </article>
        ))}
      </div>
    </div>
  )
}
