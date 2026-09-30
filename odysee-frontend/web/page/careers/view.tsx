import React from 'react';
import Page from 'component/page';
import Card from 'component/common/card';
import Button from 'component/button';
import Icon from 'component/common/icon';
import * as PAGES from 'constants/pages';
import * as ICONS from 'constants/icons';

const PERK_CLASS =
  'tw:flex tw:min-w-[140px] tw:flex-col tw:items-center tw:gap-app-xs tw:rounded-app tw:bg-[rgba(var(--color-primary-dynamic),0.1)] tw:p-app-m tw:[transition:transform_0.2s_ease] tw:[&_.icon]:text-app-primary tw:[&_span]:text-app-small tw:[&_span]:font-medium tw:[&_span]:text-[rgba(var(--color-text-base),0.9)] tw:hover:[transform:translateY(-3px)] tw:upto-tablet:min-w-[120px] tw:upto-tablet:p-app-s';
const JOB_LISTING_CLASS = String.raw`tw:relative tw:w-[500px] tw:max-w-full tw:overflow-hidden tw:rounded-[12px] tw:border-2 tw:bg-app-header tw:px-app-xl tw:py-app-m tw:text-center tw:text-app-large tw:font-semibold tw:leading-[1.4] tw:whitespace-normal tw:text-[rgba(var(--color-text-base),0.9)] tw:[overflow-wrap:break-word] tw:[box-shadow:0_4px_20px_rgba(0,0,0,0.1)] tw:[transition:all_0.3s_cubic-bezier(0.4,0,0.2,1)] tw:before:absolute tw:before:top-0 tw:before:left-[-100%] tw:before:size-full tw:before:bg-[linear-gradient(90deg,transparent,rgba(255,255,255,0.1),transparent)] tw:before:content-[''] tw:before:[transition:left_0.5s] tw:[&_.button-surface\_\_content]:justify-center tw:[&_.button-surface\_\_content]:gap-app-s tw:[&_.button-surface\_\_content]:p-0 tw:[&_.button-surface\_\_content]:whitespace-normal tw:[&_.button-surface\_\_label]:leading-[1.4] tw:[&_.button-surface\_\_label]:whitespace-normal tw:[&_.button-surface\_\_label]:[overflow-wrap:break-word] tw:[&_.icon]:shrink-0 tw:hover:[transform:translateY(-3px)_scale(1.02)] tw:hover:before:left-full tw:upto-tablet:min-w-[280px] tw:upto-tablet:px-app-m tw:upto-tablet:py-app-xs tw:upto-tablet:[font-size:var(--font-base)]`;
const FRONTEND_JOB_CLASS =
  'tw:border-[#61dafb] tw:hover:border-[#61dafb] tw:hover:text-[#61dafb] tw:hover:[box-shadow:0_8px_30px_rgba(97,218,251,0.3)]';
const BACKEND_JOB_CLASS =
  'tw:border-[#68d391] tw:hover:border-[#68d391] tw:hover:text-[#68d391] tw:hover:[box-shadow:0_8px_30px_rgba(104,211,145,0.3)]';

const CareersPage = () => {
  return (
    <Page>
      <Card
        className={String.raw`tw:mx-auto tw:max-w-[900px] tw:text-center tw:[&_.card\_\_title]:mb-app-l tw:[&_.card\_\_title]:justify-center tw:[&_.card\_\_title]:text-app-large tw:[&_.card\_\_title]:leading-[1.5] tw:[&_.card\_\_title]:text-[rgba(var(--color-text-base),0.9)] tw:upto-tablet:[&_.card\_\_title]:[font-size:var(--font-base)]`}
        body={
          <>
            <div className="tw:mb-app-l">
              <h1 className="tw:mb-app-s tw:text-[2.8rem] tw:font-bold tw:text-[var(--color-text-base)] tw:[text-shadow:0_2px_4px_rgba(0,0,0,0.1)] tw:upto-tablet:text-[2rem]">
                Work at Odysee
              </h1>
              <p className="tw:m-0 tw:text-[1.2rem] tw:font-medium tw:text-[rgba(var(--color-text-base),0.8)] tw:upto-tablet:text-[1rem]">
                Join the revolution in decentralized media
              </p>
            </div>

            <section className="section card--section">
              <h2 className="card__title">
                We're redefining online media because the current paradigm sucks.
                <br />
                If you share our passion and want to help we'd love to hear from you!
              </h2>

              <div className="tw:my-app-l tw:flex tw:flex-wrap tw:justify-center tw:gap-app-l tw:upto-tablet:gap-app-s">
                <div className={PERK_CLASS}>
                  <Icon icon={ICONS.GLOBE} size={24} />
                  <span>Remote-first culture</span>
                </div>
                <div className={PERK_CLASS}>
                  <Icon icon={ICONS.TRENDING} size={24} />
                  <span>Cutting-edge technology</span>
                </div>
                <div className={PERK_CLASS}>
                  <Icon icon={ICONS.FIRE} size={24} />
                  <span>Mission-driven team</span>
                </div>
              </div>

              <div className="tw:mx-auto tw:flex tw:max-w-[700px] tw:flex-col tw:gap-app-l tw:pt-app-l">
                <h3 className="tw:mb-app-s tw:text-[1.6rem] tw:font-semibold tw:text-[var(--color-text-base)] tw:upto-tablet:mb-app-xs tw:upto-tablet:text-[1.4rem]">
                  Current Openings
                </h3>

                <div className="tw:flex tw:flex-col tw:items-center tw:gap-app-xs">
                  <Button
                    label={'Frontend Developer – Decentralized Media Ecosystem'}
                    labelClassName="button__label--allow-shrink tw:min-w-0"
                    navigate={`https://odysee.com/@careers:4/frontenddev:8`}
                    className={`${JOB_LISTING_CLASS} ${FRONTEND_JOB_CLASS}`}
                  />
                  <p className="tw:m-0 tw:max-w-[400px] tw:[font-size:var(--font-base)] tw:text-[rgba(var(--color-text-base),0.7)] tw:italic">
                    Help build the future of content creation and discovery
                  </p>
                </div>

                <div className="tw:flex tw:flex-col tw:items-center tw:gap-app-xs">
                  <Button
                    label={'Senior Backend Engineer'}
                    labelClassName="button__label--allow-shrink tw:min-w-0"
                    navigate={`/$/${PAGES.CAREERS_SENIOR_BACKEND_ENGINEER}`}
                    className={`${JOB_LISTING_CLASS} ${BACKEND_JOB_CLASS}`}
                  />
                  <p className="tw:m-0 tw:max-w-[400px] tw:[font-size:var(--font-base)] tw:text-[rgba(var(--color-text-base),0.7)] tw:italic">
                    Scale our infrastructure for millions of creators
                  </p>
                </div>
              </div>

              <div className="tw:mt-app-l tw:rounded-app tw:border tw:border-[rgba(var(--color-primary-dynamic),0.2)] tw:bg-[linear-gradient(135deg,rgba(var(--color-primary-dynamic),0.1),rgba(var(--color-secondary-dynamic),0.1))] tw:p-app-l tw:upto-tablet:p-app-m">
                <p className="tw:mb-app-s tw:[font-size:var(--font-base)] tw:leading-[1.4] tw:text-[rgba(var(--color-text-base),0.8)] tw:upto-tablet:text-app-small">
                  Don't see a perfect fit? We're always looking for talented people who believe in our mission.
                </p>
                <p className="tw:m-0 tw:flex tw:items-center tw:justify-center tw:gap-app-s tw:[font-size:var(--font-base)] tw:text-[rgba(var(--color-text-base),0.7)] tw:[&_.icon]:text-app-primary tw:upto-tablet:flex-col tw:upto-tablet:gap-app-xs">
                  <Icon icon={ICONS.SEND} size={16} />
                  Drop us a line at{' '}
                  <span className="tw:rounded-[4px] tw:bg-[rgba(var(--color-primary-dynamic),0.1)] tw:px-[6px] tw:py-[2px] tw:font-semibold tw:text-app-primary">
                    careers@odysee.com
                  </span>
                </p>
              </div>
            </section>
          </>
        }
      />
    </Page>
  );
};

export default CareersPage;
