import fs from 'fs'
import path from 'path'
import matter from 'gray-matter'
import { remark } from 'remark'
import html from 'remark-html'

const postsDirectory = path.join(process.cwd(), 'content/blog')

export interface BlogPost {
  slug: string
  title: string
  description: string
  date: string
  content: string
  contentHtml?: string
}

export function getAllPosts(): BlogPost[] {
  if (!fs.existsSync(postsDirectory)) return []
  const fileNames = fs.readdirSync(postsDirectory)
  const posts = fileNames
    .filter((f) => f.endsWith('.md'))
    .map((fileName) => {
      const slug = fileName.replace(/\.md$/, '')
      const fullPath = path.join(postsDirectory, fileName)
      const fileContents = fs.readFileSync(fullPath, 'utf8')
      const { data, content } = matter(fileContents)
      return {
        slug: data.slug || slug,
        title: data.title || '',
        description: data.description || '',
        date: data.date || '',
        content,
      } as BlogPost
    })
    .sort((a, b) => (a.date < b.date ? 1 : -1))
  return posts
}

export async function getPostBySlug(slug: string): Promise<BlogPost | null> {
  const posts = getAllPosts()
  const post = posts.find((p) => p.slug === slug)
  if (!post) return null
  const processed = await remark().use(html).process(post.content)
  return { ...post, contentHtml: processed.toString() }
}
