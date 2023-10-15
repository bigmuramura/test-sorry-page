import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3deploy from "aws-cdk-lib/aws-s3-deployment"

export class TestSorryPageStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // VPC
    const vpc = new cdk.aws_ec2.Vpc(this,"Vpc",{
      ipAddresses: cdk.aws_ec2.IpAddresses.cidr("10.1.0.0/16"),
      enableDnsHostnames: true,
      enableDnsSupport: true,
      natGateways: 1,
      maxAzs: 2,
      subnetConfiguration :[
          {
              name: "PublicSubnet",
              subnetType: cdk.aws_ec2.SubnetType.PUBLIC,
              cidrMask: 24,
              mapPublicIpOnLaunch: true,
          },
          {
              name: "PrivateSubnet",
              subnetType: cdk.aws_ec2.SubnetType.PRIVATE_WITH_EGRESS,
              cidrMask: 24,
          },
      ],
      gatewayEndpoints:{
          s3: {
              service: cdk.aws_ec2.GatewayVpcEndpointAwsService.S3,
          },
      },
    });

    // ECS Cluster
    const cluster = new cdk.aws_ecs.Cluster(this, "Cluster", {
      vpc: vpc,
    });

    // ALB & Fargate Service
    const service = new cdk.aws_ecs_patterns.ApplicationLoadBalancedFargateService(
      this,
      "SampleWebService",
      {
        publicLoadBalancer: true,
        cluster: cluster,
        cpu: 256,
        desiredCount: 1,
        memoryLimitMiB: 512,
        assignPublicIp: false,
        taskSubnets: { subnetType: cdk.aws_ec2.SubnetType.PRIVATE_WITH_EGRESS },
        taskImageOptions: {
          image: cdk.aws_ecs.ContainerImage.fromRegistry('amazon/amazon-ecs-sample'),
          },
      },
    )

    // CloudFront + S3
    // S3
    const sorryPageBucket = new cdk.aws_s3.Bucket(this, "sorry-page-bucket", {
      // bucketName: "sorry-page-bucket",
      versioned: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      // autoDeleteObjects: true,
      blockPublicAccess: cdk.aws_s3.BlockPublicAccess.BLOCK_ALL,

      cors: [
        {
          allowedMethods: [cdk.aws_s3.HttpMethods.GET, cdk.aws_s3.HttpMethods.HEAD],
          allowedOrigins: ["*"],
          allowedHeaders: ["*"],
        },
      ],
    });
    // Deploy contents to S3
    new s3deploy.BucketDeployment(this, "DeployContents", {
      sources: [s3deploy.Source.asset("./lib/sorry-page-contents")],
      destinationBucket: sorryPageBucket,
      retainOnDelete: false,
    })

    // OAC
    const cfnOriginAccessControl = new cdk.aws_cloudfront.CfnOriginAccessControl(
      this,
      "OriginAccessControl",
      {
        originAccessControlConfig: {
          name: "OriginAccessControlForAppBucket",
          originAccessControlOriginType: "s3",
          signingBehavior: "always",
          signingProtocol: "sigv4",
          description: "S3 Access Control",
        },
      }
    );
    // CloudFront
    const distribution = new cdk.aws_cloudfront.Distribution(this, 'Distribution', {
      comment: 'distribution.',
      defaultBehavior: {
        origin: new cdk.aws_cloudfront_origins.S3Origin(sorryPageBucket),
      },
      defaultRootObject: 'index.html',
      httpVersion: cdk.aws_cloudfront.HttpVersion.HTTP2_AND_3,
    });
    const cfnDistribution = distribution.node.defaultChild as cdk.aws_cloudfront.CfnDistribution;
    // Delete OAI
    cfnDistribution.addPropertyOverride('DistributionConfig.Origins.0.S3OriginConfig.OriginAccessIdentity', '');
    // Setting OAC
    cfnDistribution.addPropertyOverride('DistributionConfig.Origins.0.OriginAccessControlId', cfnOriginAccessControl.attrId);

    // S3 BucketPolicy
    const sorryPageBucketPolicyStatement = new cdk.aws_iam.PolicyStatement({
      actions: ['s3:GetObject'],
      effect: cdk.aws_iam.Effect.ALLOW,
      principals: [new cdk.aws_iam.ServicePrincipal('cloudfront.amazonaws.com')],
      resources: [`${sorryPageBucket.bucketArn}/*`],
      conditions: {
        StringEquals: {
          "AWS:SourceArn": `arn:aws:cloudfront::${this.account}:distribution/${distribution.distributionId}`,
        },
      },
    });
    sorryPageBucket.addToResourcePolicy(sorryPageBucketPolicyStatement);
  };
}
