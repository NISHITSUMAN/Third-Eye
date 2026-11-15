import {
  BookOpen,
  Github,
  Linkedin,
  LayoutDashboard,
  Microscope,
  PanelsTopLeft,
  PenLine,
  Users,
} from 'lucide-react';

type TeamMember = {
  number: string;
  name: string;
  initials: string;
  position: string;
  contribution: string;
  group: string;
  icon: typeof LayoutDashboard;
  lead?: boolean;
  github?: string;
  linkedin?: string;
};

const teamMembers: TeamMember[] = [
  {
    number: '01',
    name: 'Nishit Suman',
    initials: 'NS',
    position: 'Team Lead',
    contribution: 'Full-stack development of the main project dashboard.',
    group: 'PROJECT DEVELOPMENT',
    icon: LayoutDashboard,
    lead: true,
    github: 'https://github.com/NISHITSUMAN',
    linkedin: 'https://www.linkedin.com/in/nishit-s-a4431b375/',
  },
  {
    number: '02',
    name: 'Shayan Shaikh',
    initials: 'SS',
    position: 'Full-stack Developer',
    contribution: 'Full-stack development of the project landing page.',
    group: 'WEB EXPERIENCE',
    icon: PanelsTopLeft,
    github: 'https://github.com/shayanSY',
    linkedin: 'https://www.linkedin.com/in/shayan-shaikh-ab0a93422/',
  },
  {
    number: '03',
    name: 'Nikhil Kaware',
    initials: 'NK',
    position: 'Full-stack Developer',
    contribution: 'Full-stack development of the project learning page.',
    group: 'LEARNING EXPERIENCE',
    icon: BookOpen,
    github: 'https://github.com/Nikhilkaware36',
    linkedin: 'https://www.linkedin.com/in/nikhil-kaware/',
  },
  {
    number: '04',
    name: 'Soham Phegade',
    initials: 'SP',
    position: 'Storyteller',
    contribution: 'Shapes the project narrative and communicates its purpose.',
    group: 'COMMUNICATION',
    icon: PenLine,
  },
  {
    number: '05',
    name: 'Shravan Vipul',
    initials: 'SV',
    position: 'Researcher',
    contribution: 'Supports the project through research and scientific context.',
    group: 'RESEARCH',
    icon: Microscope,
    github: 'https://github.com/shravanvipul20-cyber',
    linkedin: 'https://www.linkedin.com/in/shravan-vipul-5b585844b',
  },
];

export default function Team() {
  return (
    <div className="page-shell section-wrap team-page">
      <section className="page-hero team-page-hero" aria-labelledby="team-page-title">
        <div className="team-hero-copy">
          <span className="eyebrow">TEAM / 03 — THE PEOPLE</span>
          <h1 id="team-page-title">Team<br /><span className="text-muted">Cypher.</span></h1>
          <p>
            Five members bringing together product development, storytelling and research
            to build Third Eye.
          </p>
        </div>
        <div className="team-emblem-wrap">
          <span className="team-emblem-label"><span className="status-dot" /> TEAM Cypher / EMBLEM</span>
          <img
            className="team-emblem-image"
            src="/team-Cypher-eye.png"
            alt="Team Cypher eye emblem with a cyan orbital path"
            loading="eager"
            decoding="async"
          />
        </div>
      </section>

      <section className="team-overview" aria-label="Team overview">
        <div className="team-overview-copy">
          <span className="eyebrow"><span className="status-dot" /> TEAM DIRECTORY</span>
          <h2>Different roles.<br /><span className="text-muted">One shared direction.</span></h2>
          <p>
            Each member contributes to a different part of the project — from the
            application experience to the research and story behind it.
          </p>
        </div>
        <div className="team-count" aria-label="Five team members">
          <strong>05</strong>
          <span>TEAM MEMBERS</span>
        </div>
      </section>

      <section className="team-grid" aria-label="Team Cypher members">
        {teamMembers.map((member) => {
          const Icon = member.icon;
          return (
            <article className={`team-member-card${member.lead ? ' team-member-lead' : ''}`} key={member.number}>
              <div className="team-card-topline">
                <span>{member.number} / {member.group}</span>
                {member.lead && <span className="team-lead-badge">TEAM LEAD</span>}
              </div>
              <div className="team-member-identity">
                <div className="team-initials" aria-hidden="true">{member.initials}</div>
                <div className="team-member-icon" aria-hidden="true"><Icon size={18} strokeWidth={1.5} /></div>
              </div>
              <h3>{member.name}</h3>
              <p className="team-member-role">{member.position}</p>
              <div className="team-member-divider" />
              <span className="eyebrow team-contribution-label">CONTRIBUTION</span>
              <p className="team-member-contribution">{member.contribution}</p>
              {(member.github || member.linkedin) && (
                <div className="team-social-links" aria-label={`${member.name} social profiles`}>
                  {member.github && (
                    <a href={member.github} target="_blank" rel="noopener noreferrer" aria-label={`${member.name} on GitHub`} title="GitHub profile">
                      <Github size={15} strokeWidth={1.8} aria-hidden="true" />
                      <span>GitHub</span>
                    </a>
                  )}
                  {member.linkedin && (
                    <a href={member.linkedin} target="_blank" rel="noopener noreferrer" aria-label={`${member.name} on LinkedIn`} title="LinkedIn profile">
                      <Linkedin size={15} strokeWidth={1.8} aria-hidden="true" />
                      <span>LinkedIn</span>
                    </a>
                  )}
                </div>
              )}
              <span className="team-card-index">THIRD EYE · TEAM Cypher</span>
            </article>
          );
        })}
      </section>

      <section className="team-closing-note">
        <div className="team-closing-icon"><Users size={19} strokeWidth={1.5} /></div>
        <div>
          <span className="eyebrow">COLLABORATION</span>
          <p>Built through shared effort across development, communication and research.</p>
        </div>
      </section>
    </div>
  );
}
