import * as React from 'react';
import * as ICONS from 'constants/icons';
import * as MODALS from 'constants/modal_types';
import { formatCredits } from 'util/format-credits';
import FileDetails from 'component/fileDetails';
import GeoRestictionInfo from 'component/geoRestictionInfo';
import ClaimAuthor from 'component/claimAuthor';
import FileTitle from 'component/fileTitle';
import FileActions from 'component/fileActions';
import StreamClaimRenderInline from 'component/streamClaimRenderInline';
import FileValues from 'component/fileValues';
import FileViewCount from 'component/fileViewCount';
import ClaimTags from 'component/claimTags';
import DateTime from 'component/dateTime';
import Button from 'component/button';
import LbcSymbol from 'component/common/lbc-symbol';
import classnames from 'classnames';
import { useAppSelector, useAppDispatch } from 'redux/hooks';
import { selectClaimForUri, selectClaimIsMineForUri } from 'redux/selectors/claims';
import { selectNoRestrictionOrUserIsMemberForContentClaimId } from 'redux/selectors/memberships';
import { doOpenModal } from 'redux/actions/app';
import { POST_CONTAINER_CLASS, POST_INFO_DIM_CLASS, POST_VIEWER_CLASS } from './classes';

const EXPAND = {
  NONE: 'none',
  CREDIT_DETAILS: 'credit_details',
  FILE_DETAILS: 'file_details',
};
const POST_INFO_CLASS_NAME = String.raw`tw:flex tw:items-center tw:justify-between tw:text-app-small tw:[&_.credit-amount]:mr-app-s`;
const POST_DATE_CLASS_NAME = String.raw`tw:flex tw:text-app-small tw:text-[var(--color-help)] tw:[&_.date\_time]:mr-app-m tw:[&_.date\_time]:text-app-small tw:[&_.date\_time]:text-app-text-subtitle`;
const POST_INFO_GROUP_CLASS_NAME = String.raw`tw:flex tw:[&_.button-surface--link]:mr-app-s tw:[&_.button-surface--link:last-of-type]:mr-0 tw:[&_.button-surface\_\_content]:text-app-primary tw:[&_.button-surface\_\_content_.icon]:text-app-text-subtitle tw:[&_.button-surface\_\_content:hover]:text-app-secondary`;
type Props = {
  uri: string;
};

function PostViewer(props: Props) {
  const { uri } = props;
  const dispatch = useAppDispatch();
  const claim = useAppSelector((state) => selectClaimForUri(state, uri));
  const claimIsMine = useAppSelector((state) => selectClaimIsMineForUri(state, uri));
  const contentUnlocked = useAppSelector(
    (state) => claim && selectNoRestrictionOrUserIsMemberForContentClaimId(state, claim.claim_id)
  );

  const [expand, setExpand] = React.useState(EXPAND.NONE);

  if (!claim) {
    return null;
  }

  const amount = parseFloat(claim.amount) + parseFloat(claim.meta.support_amount);
  const formattedAmount = formatCredits(amount, 2, true);
  const hasSupport = claim && claim.meta && claim.meta.support_amount && Number(claim.meta.support_amount) > 0;

  function handleExpand(newExpand) {
    if (expand === newExpand) {
      setExpand(EXPAND.NONE);
    } else {
      setExpand(newExpand);
    }
  }

  return (
    <div className={POST_VIEWER_CLASS}>
      <FileTitle
        uri={uri}
        className="tw:mt-0 tw:mb-app-s tw:text-[2rem] tw:leading-[1.2] tw:font-bold tw:[font-family:Georgia,serif] tw:[word-break:break-word] tw:[&_:first-child]:mr-app-s tw:[&_:first-child]:inline-block tw:small:mt-app-xl tw:small:text-[3rem] tw:small:leading-none"
      />
      <GeoRestictionInfo uri={uri} />
      <div className={classnames(POST_INFO_CLASS_NAME, expand !== EXPAND.NONE ? 'tw:mb-app-s' : 'tw:mb-app-l')}>
        <span className={POST_DATE_CLASS_NAME}>
          <DateTime uri={uri} type="date" />
          {contentUnlocked && <FileViewCount uri={uri} />}
        </span>
        <div className={POST_INFO_GROUP_CLASS_NAME}>
          <Button
            button="link"
            className={POST_INFO_DIM_CLASS}
            icon={ICONS.INFO}
            aria-label={__('View claim details')}
            onClick={() => handleExpand(EXPAND.FILE_DETAILS)}
          />
          <Button button="link" className={POST_INFO_DIM_CLASS} onClick={() => handleExpand(EXPAND.CREDIT_DETAILS)}>
            <LbcSymbol postfix={expand === EXPAND.CREDIT_DETAILS ? __('Hide') : formattedAmount} />
          </Button>
          {claimIsMine && hasSupport && (
            <Button
              button="link"
              className="expandable__button"
              icon={ICONS.UNLOCK}
              aria-label={__('Unlock tips')}
              onClick={() => {
                dispatch(
                  doOpenModal(MODALS.LIQUIDATE_SUPPORTS, {
                    uri,
                  })
                );
              }}
            />
          )}
        </div>
      </div>

      {expand === EXPAND.CREDIT_DETAILS && (
        <div className="section tw:mt-app-l tw:mb-app-l tw:[&_.tag]:mt-0">
          <FileValues uri={uri} />
        </div>
      )}

      {expand === EXPAND.FILE_DETAILS && (
        <div className="section tw:mt-app-l tw:mb-app-l tw:[&_.tag]:mt-0">
          <ClaimTags uri={uri} type="large" />
          <FileDetails uri={uri} />
        </div>
      )}

      <ClaimAuthor uri={uri} />

      <div className={POST_CONTAINER_CLASS}>
        <StreamClaimRenderInline uri={uri} />
      </div>
      <FileActions uri={uri} />
    </div>
  );
}

export default PostViewer;
