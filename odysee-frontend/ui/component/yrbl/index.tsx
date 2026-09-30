import * as React from 'react';
import classnames from 'classnames';
import { YRBL_HAPPY_IMG_URL, YRBL_SAD_IMG_URL } from 'config';
import { YRBL_CLASSES as C } from './classes';
import { SECTION_CLASSES } from 'component/common/section-classes';
import { getThumbnailCdnUrl } from 'util/thumbnail';
type Props = {
  title?: string;
  subtitle?: string | React.ReactNode;
  type: string;
  className?: string;
  actions?: React.ReactNode;
  alwaysShow?: boolean;
};
const yrblTypes = {
  happy: getThumbnailCdnUrl({ thumbnail: YRBL_HAPPY_IMG_URL }),
  sad: getThumbnailCdnUrl({ thumbnail: YRBL_SAD_IMG_URL }),
};
export default class extends React.PureComponent<Props> {
  static defaultProps = {
    type: 'happy',
  };

  render() {
    const { title, subtitle, type, className, actions, alwaysShow = false } = this.props;
    const image = yrblTypes[type];
    return (
      <div className={C.root}>
        <img
          alt="Friendly gerbil"
          className={classnames(C.image, className, {
            [C.alwaysShow]: alwaysShow,
          })}
          src={`${image}`}
        />
        <div>
          {(title || subtitle) && (
            <div className={C.content}>
              <h2 className={SECTION_CLASSES.title}>{title}</h2>
              <div className={SECTION_CLASSES.subtitle}>{subtitle}</div>
            </div>
          )}
          {actions}
        </div>
      </div>
    );
  }
}
