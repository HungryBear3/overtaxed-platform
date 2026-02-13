"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { analytics } from "@/lib/analytics/events"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Send, CheckCircle2, AlertCircle } from "lucide-react"

type FormData = {
  name: string
  email: string
  subject: string
  message: string
  category: string
}

type FormErrors = Partial<Record<keyof FormData, string>>

export function ContactForm() {
  const [formData, setFormData] = useState<FormData>({
    name: "",
    email: "",
    subject: "",
    message: "",
    category: "",
  })
  const [errors, setErrors] = useState<FormErrors>({})
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitStatus, setSubmitStatus] = useState<{
    type: "success" | "error" | null
    message: string
  }>({ type: null, message: "" })

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => {
    const { name, value } = e.target
    setFormData((prev) => ({ ...prev, [name]: value }))
    if (errors[name as keyof FormData]) {
      setErrors((prev) => ({ ...prev, [name]: undefined }))
    }
  }

  const validateForm = (): boolean => {
    const newErrors: FormErrors = {}
    if (!formData.name.trim()) newErrors.name = "Name is required"
    else if (formData.name.trim().length < 2) newErrors.name = "Name must be at least 2 characters"
    if (!formData.email.trim()) newErrors.email = "Email is required"
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email))
      newErrors.email = "Please enter a valid email address"
    if (!formData.subject.trim()) newErrors.subject = "Subject is required"
    else if (formData.subject.trim().length < 3)
      newErrors.subject = "Subject must be at least 3 characters"
    if (!formData.message.trim()) newErrors.message = "Message is required"
    else if (formData.message.trim().length < 10)
      newErrors.message = "Message must be at least 10 characters"
    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitStatus({ type: null, message: "" })
    if (!validateForm()) return

    setIsSubmitting(true)
    try {
      const response = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: formData.name.trim(),
          email: formData.email.trim(),
          subject: formData.subject.trim(),
          message: formData.message.trim(),
          category: formData.category || undefined,
        }),
      })
      const data = await response.json()

      if (!response.ok) throw new Error(data.error || "Failed to send message")

      analytics.contactFormSubmit(formData.category || undefined)
      setSubmitStatus({ type: "success", message: data.message || "Your message has been sent successfully!" })
      setFormData({ name: "", email: "", subject: "", message: "", category: "" })
    } catch (error) {
      setSubmitStatus({
        type: "error",
        message: error instanceof Error ? error.message : "Something went wrong. Please try again.",
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Card className="shadow-lg">
      <CardHeader>
        <CardTitle className="text-2xl">Send Us a Message</CardTitle>
        <CardDescription>
          Fill out the form below and we&apos;ll get back to you within 2-3 business days.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-6">
          {submitStatus.type && (
            <Alert
              variant={submitStatus.type === "success" ? "success" : "destructive"}
            >
              {submitStatus.type === "success" ? (
                <CheckCircle2 className="h-4 w-4 text-green-600" />
              ) : (
                <AlertCircle className="h-4 w-4" />
              )}
              <AlertTitle>{submitStatus.type === "success" ? "Success" : "Error"}</AlertTitle>
              <AlertDescription>{submitStatus.message}</AlertDescription>
            </Alert>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <Label htmlFor="name">Name <span className="text-red-500">*</span></Label>
              <Input
                id="name"
                name="name"
                value={formData.name}
                onChange={handleChange}
                placeholder="Your full name"
                disabled={isSubmitting}
                className={errors.name ? "border-red-500" : ""}
              />
              {errors.name && <p className="text-sm text-red-500">{errors.name}</p>}
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Email <span className="text-red-500">*</span></Label>
              <Input
                id="email"
                name="email"
                type="email"
                value={formData.email}
                onChange={handleChange}
                placeholder="your.email@example.com"
                disabled={isSubmitting}
                className={errors.email ? "border-red-500" : ""}
              />
              {errors.email && <p className="text-sm text-red-500">{errors.email}</p>}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="category">Category (Optional)</Label>
            <select
              id="category"
              name="category"
              value={formData.category}
              onChange={handleChange}
              disabled={isSubmitting}
              className="flex h-10 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            >
              <option value="">Select a category</option>
              <option value="general">General Inquiry</option>
              <option value="appeal-question">Appeal Process Question</option>
              <option value="technical">Technical Issue</option>
              <option value="billing">Billing Question</option>
              <option value="refund">Refund Request</option>
              <option value="other">Other</option>
            </select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="subject">Subject <span className="text-red-500">*</span></Label>
            <Input
              id="subject"
              name="subject"
              value={formData.subject}
              onChange={handleChange}
              placeholder="What is your message about?"
              disabled={isSubmitting}
              className={errors.subject ? "border-red-500" : ""}
            />
            {errors.subject && <p className="text-sm text-red-500">{errors.subject}</p>}
          </div>

          <div className="space-y-2">
            <Label htmlFor="message">Message <span className="text-red-500">*</span></Label>
            <Textarea
              id="message"
              name="message"
              value={formData.message}
              onChange={handleChange}
              placeholder="Please provide details..."
              rows={6}
              disabled={isSubmitting}
              className={errors.message ? "border-red-500" : ""}
              maxLength={5000}
            />
            <p className="text-xs text-gray-500">{formData.message.length}/5000 characters</p>
            {errors.message && <p className="text-sm text-red-500">{errors.message}</p>}
          </div>

          <Button type="submit" size="lg" className="w-full" disabled={isSubmitting}>
            {isSubmitting ? (
              <>Sending...</>
            ) : (
              <>
                <Send className="mr-2 h-4 w-4" />
                Send Message
              </>
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
