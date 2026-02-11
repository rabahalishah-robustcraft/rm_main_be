import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding database...');

  // Seed Industries
  const industries = [
    {
      name: 'Technology',
      description: 'Software, hardware, and tech services',
      jobTitles: [
        'Software Engineer',
        'Product Manager',
        'Data Scientist',
        'DevOps Engineer',
        'UX Designer',
        'Technical Lead',
        'Engineering Manager'
      ]
    },
    {
      name: 'Finance',
      description: 'Banking, investment, and financial services',
      jobTitles: [
        'Financial Analyst',
        'Investment Banker',
        'Portfolio Manager',
        'Risk Analyst',
        'Quantitative Analyst',
        'Financial Advisor'
      ]
    },
    {
      name: 'Healthcare',
      description: 'Medical, pharmaceutical, and health services',
      jobTitles: [
        'Physician',
        'Nurse',
        'Medical Researcher',
        'Healthcare Administrator',
        'Pharmacist',
        'Medical Device Engineer'
      ]
    },
    {
      name: 'Consulting',
      description: 'Management and strategy consulting',
      jobTitles: [
        'Management Consultant',
        'Strategy Consultant',
        'Business Analyst',
        'Senior Associate',
        'Principal',
        'Partner'
      ]
    }
  ];

  for (const industry of industries) {
    await prisma.industry.upsert({
      where: { name: industry.name },
      update: industry,
      create: industry
    });
  }

  // Seed System Settings
  const systemSettings = [
    { key: 'free_tier_monthly_limit', value: '3', type: 'number' },
    { key: 'max_audio_file_size_mb', value: '50', type: 'number' },
    { key: 'max_resume_file_size_mb', value: '10', type: 'number' },
    { key: 'supported_audio_formats', value: '["mp3", "wav", "m4a", "ogg"]', type: 'json' },
    { key: 'supported_resume_formats', value: '["pdf", "doc", "docx"]', type: 'json' },
    { key: 'openai_model_transcription', value: 'whisper-1', type: 'string' },
    { key: 'openai_model_analysis', value: 'gpt-4', type: 'string' },
    { key: 'jwt_token_expiry_days', value: '7', type: 'number' }
  ];

  for (const setting of systemSettings) {
    await prisma.systemSetting.upsert({
      where: { key: setting.key },
      update: setting,
      create: setting
    });
  }

  console.log('Database seeded successfully!');
}

main()
  .catch((e) => {
    console.error('Error seeding database:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });